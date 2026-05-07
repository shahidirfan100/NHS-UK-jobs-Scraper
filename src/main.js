// NHS UK Jobs Scraper - High Speed API-based
import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { load as cheerioLoad } from 'cheerio';
import { BasicCrawler, Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

await Actor.main(async () => {
    const actorInput = (await Actor.getInput()) || {};
    const isMeaningfulInputValue = (value) => {
        if (value === undefined || value === null) return false;
        if (typeof value === 'string') return value.trim() !== '';
        return true;
    };
    const hasMeaningfulActorInput = Object.values(actorInput).some(isMeaningfulInputValue);
    const fallbackInput = await readFile(new URL('../INPUT.json', import.meta.url), 'utf8')
        .then((raw) => JSON.parse(raw))
        .catch(() => ({}));
    const input = hasMeaningfulActorInput ? actorInput : fallbackInput;
    const {
        startUrl,
        keyword = '',
        location = '',
        results_wanted: RESULTS_WANTED_RAW = 20,
        max_pages: MAX_PAGES_RAW = 5,
        collectDetails = true,
        proxyConfiguration,
    } = input;

    const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 20;
    const rawMaxPages = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 5;
    const minimumPagesForRequestedResults = Math.ceil(RESULTS_WANTED / 10) + 5;
    const MAX_PAGES = Math.max(rawMaxPages, minimumPagesForRequestedResults);
    const API_BASE_URL = 'https://www.jobs.nhs.uk/api/v1/search_xml';
    
    log.setLevel(log.LEVELS.INFO);
    if (!hasMeaningfulActorInput && Object.keys(fallbackInput).length) log.info('Loaded INPUT.json fallback values for local run');

    const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;
    
    const fixEncoding = (v) => v ? String(v).replace(/Â£/g, '£').replace(/Â/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : null;

    const squash = (v) => {
        let t = fixEncoding(v);
        if (!t) return null;
        if (t.length % 2 === 0) {
            const h = t.length / 2;
            if (t.slice(0, h).trim() === t.slice(h).trim()) t = t.slice(0, h);
        }
        const tok = t.split(/\s+/);
        if (tok.length > 1) {
            const u = [];
            for (const s of tok) if (!u.length || u[u.length - 1] !== s) u.push(s);
            t = u.join(' ');
        }
        return t.trim() || null;
    };

    const formatDate = (v) => {
        if (!v) return null;
        try {
            const d = new Date(v);
            return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
        } catch { return v; }
    };

    const sanitizeHtml = (html) => {
        if (!html) return null;
        const $ = cheerioLoad(`<div id="r">${html}</div>`, { decodeEntities: false });
        const $r = $('#r');
        $r.find('script, style, noscript, iframe, svg, canvas, form, button, input, select, textarea, nav, header, footer, aside, img, picture, video, audio, source, .show-mobile, .forms-wrapper-white, .nhsuk-action-link, .save-job, .nhsuk-button, .nhs-open-job-inset').remove();
        $r.find('*').each((_, el) => {
            const tag = el.tagName?.toLowerCase();
            if (!tag || !new Set(['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'br', 'strong', 'em', 'b', 'i', 'a']).has(tag)) {
                $(el).replaceWith($(el).contents());
            } else {
                const attrs = el.attribs || {};
                for (const k of Object.keys(attrs)) if (k !== 'href' || tag !== 'a') $(el).removeAttr(k);
            }
        });
        const out = $r.html()?.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        return out ? fixEncoding(out) : null;
    };

    const toText = (html) => {
        if (!html) return null;
        const $ = cheerioLoad(`<div id="r">${html}</div>`, { decodeEntities: true });
        const lines = [];
        $('#r').find('h2,h3,h4,p,li').filter((_, el) => $(el).parents('h2,h3,h4,p,li').length === 0).each((_, el) => {
            const t = $(el).text().replace(/\s+/g, ' ').trim();
            if (t) lines.push(el.tagName.toLowerCase() === 'li' ? `- ${t}` : t);
        });
        return lines.join('\n\n').trim() || null;
    };

    const firstText = ($, selector) => squash($(selector).first().text());
    const joinFields = ($, selectors) => {
        const parts = selectors
            .map((selector) => firstText($, selector))
            .filter(Boolean);
        return parts.length ? squash(parts.join(', ')) : null;
    };

    const buildUrl = (p = 1) => {
        if (startUrl && p === 1) return startUrl;
        const u = new URL(API_BASE_URL);
        if (keyword) u.searchParams.set('keyword', keyword);
        if (location) u.searchParams.set('location', location);
        if (p > 1) u.searchParams.set('page', p);
        return u.href;
    };

    let saved = 0;
    const seen = new Set();
    const batch = [];
    const BATCH_SIZE = 10;
    let scheduledDetails = 0;
    let flushChain = Promise.resolve();

    const flush = async () => {
        flushChain = flushChain.then(async () => {
            if (!batch.length) return;
            const items = batch.splice(0, batch.length);
            await Dataset.pushData(items);
            saved += items.length;
            if (saved % 20 === 0 || saved >= RESULTS_WANTED) log.info(`Progress: ${saved} jobs saved`);
        });
        await flushChain;
    };

    const requestQueue = await Actor.openRequestQueue();

    const crawler = new BasicCrawler({
        maxConcurrency: 20,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 20,
        requestQueue,
        async requestHandler({ request, crawler: c }) {
            const { label, page = 1, fromList } = request.userData;
            
            if (label === 'LIST') {
                const { body } = await gotScraping({ url: request.url, proxyUrl: proxyConf?.newUrl(), timeout: { request: 15000 } });
                const $ = cheerioLoad(body, { xmlMode: true });
                const jobs = [];
                $('vacancyDetails').each((_, el) => {
                    const $v = $(el);
                    const ref = squash($v.children('reference').text());
                    const url = $v.children('url').text()?.replace('beta.jobs.nhs.uk', 'www.jobs.nhs.uk');
                    if (ref && !seen.has(ref)) {
                        seen.add(ref);
                        jobs.push({
                            title: squash($v.children('title').text()),
                            company: squash($v.children('employer').text()),
                            salary: squash($v.children('salary').text()),
                            contract_type: squash($v.children('type').text()),
                            date_posted: formatDate($v.children('postDate').text()),
                            closing_date: formatDate($v.children('closeDate').text()),
                            reference: ref,
                            url,
                            location: squash($v.find('location').first().text()),
                        });
                    }
                });
                log.info(`Found ${jobs.length} jobs on page ${page}`);

                const remaining = Math.max(0, RESULTS_WANTED - (saved + batch.length + scheduledDetails));
                const toProc = jobs.slice(0, remaining);
                if (collectDetails) {
                    const detailRequests = toProc
                        .filter((job) => job.url)
                        .map((job) => ({ url: job.url, userData: { label: 'DETAIL', fromList: job } }));
                    scheduledDetails += detailRequests.length;
                    await c.addRequests(detailRequests);
                } else {
                    batch.push(...toProc);
                    if (batch.length >= BATCH_SIZE) await flush();
                }

                if ((saved + batch.length + scheduledDetails) < RESULTS_WANTED && page < MAX_PAGES && jobs.length > 0) {
                    await c.addRequests([{ url: buildUrl(page + 1), userData: { label: 'LIST', page: page + 1 } }]);
                }
                return;
            }

            if (label === 'DETAIL') {
                const { body } = await gotScraping({ url: request.url, proxyUrl: proxyConf?.newUrl(), timeout: { request: 15000 } });
                const $ = cheerioLoad(body);
                const l = fromList || {};
                const wrap = $('div.nhsuk-grid-column-two-thirds.wrap-paragraphs, div.wrap-paragraphs').first();
                const d_html = sanitizeHtml(wrap.html());
                
                const item = {
                    title: firstText($, '#heading') || l.title,
                    company: firstText($, '#employer_name') || l.company,
                    location: joinFields($, ['#employer_address_line_1', '#employer_address_line_2', '#employer_address_line_3', '#employer_town', '#employer_county', '#employer_postcode']) || l.location,
                    salary: firstText($, '#range_salary') || firstText($, '#fixed_salary') || firstText($, '#salary') || l.salary,
                    contract_type: firstText($, '#contract_type') || l.contract_type,
                    working_pattern: squash($('#working_pattern_heading').first().next('p').first().text()) || l.working_pattern,
                    date_posted: l.date_posted, closing_date: l.closing_date,
                    reference: l.reference || firstText($, '#trac-job-reference'),
                    description_html: d_html, description_text: toText(d_html), url: request.url,
                };

                const clean = {};
                ['title', 'company', 'location', 'salary', 'contract_type', 'working_pattern', 'date_posted', 'closing_date', 'reference', 'url', 'description_html', 'description_text'].forEach(k => { if (item[k]) clean[k] = item[k]; });
                
                batch.push(clean);
                scheduledDetails = Math.max(0, scheduledDetails - 1);
                if (batch.length >= BATCH_SIZE) await flush();
            }
        },
    });

    await requestQueue.addRequest({ url: buildUrl(1), userData: { label: 'LIST', page: 1 } });
    await crawler.run();
    await flush();
    log.info(`Scraping completed. Total: ${saved}`);
});
