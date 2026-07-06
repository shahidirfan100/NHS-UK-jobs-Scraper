// NHS UK Jobs Scraper - High Speed API-based
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Actor, log } from 'apify';
import { load as cheerioLoad } from 'cheerio';
import { BasicCrawler, Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

/** Retry gotScraping with exponential backoff for transient failures (429, 5xx, ETIMEDOUT). */
const fetchWithRetry = async (url, opts = {}, retries = 3) => {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await gotScraping({ url, ...opts });
            const status = res.statusCode ?? 200;
            if (status === 429 || (status >= 500 && status < 600)) {
                const wait = Math.min(1000 * 2 ** attempt, 30000);
                log.warning(`HTTP ${status} on attempt ${attempt}/${retries} - retrying in ${wait}ms: ${url}`);
                await new Promise((r) => { setTimeout(r, wait); });
                lastErr = new Error(`HTTP ${status}`);
                continue;
            }
            return res;
        } catch (err) {
            const isRetryable =
                err.code === 'ETIMEDOUT' ||
                err.code === 'ECONNRESET' ||
                err.code === 'ECONNREFUSED' ||
                /timeout/i.test(err.message);
            if (isRetryable && attempt < retries) {
                const wait = Math.min(1000 * 2 ** attempt, 30000);
                log.warning(`${err.code || 'NetworkError'} on attempt ${attempt}/${retries} - retrying in ${wait}ms: ${url}`);
                await new Promise((r) => { setTimeout(r, wait); });
                lastErr = err;
            } else {
                throw err;
            }
        }
    }
    throw lastErr;
};

/** Normalize a URL string - trim whitespace and ensure https scheme. Returns null if invalid. */
const normalizeUrl = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        return new URL(withScheme).href;
    } catch {
        log.warning(`Invalid URL ignored: "${trimmed}"`);
        return null;
    }
};

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
        startUrl: startUrlRaw,
        keyword = '',
        location = '',
        results_wanted: RESULTS_WANTED_RAW = 20,
        max_pages: MAX_PAGES_RAW = 5,
        collectDetails = true,
        proxyConfiguration,
    } = input;

    // Normalize and validate startUrl - warn and ignore if malformed
    const cleanStartUrl = normalizeUrl(startUrlRaw);
    if (startUrlRaw && !cleanStartUrl) {
        log.warning(`Provided startUrl is invalid and will be ignored: ${startUrlRaw}`);
    }

    const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 20;
    const rawMaxPages = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 5;
    const minimumPagesForRequestedResults = Math.ceil(RESULTS_WANTED / 10) + 5;
    const MAX_PAGES = Math.max(rawMaxPages, minimumPagesForRequestedResults);
    const API_BASE_URL = 'https://www.jobs.nhs.uk/api/v1/search_xml';

    log.setLevel(log.LEVELS.INFO);
    if (!hasMeaningfulActorInput && Object.keys(fallbackInput).length) {
        log.info('Loaded INPUT.json fallback values for local run');
    }

    const cleanKeyword = typeof keyword === 'string' ? keyword.trim() : '';
    const cleanLocation = typeof location === 'string' ? location.trim() : '';

    // Load API discovery file case-insensitively (works with API_DISCOVERY.md or api_discovery.md)
    const loadApiDiscovery = async () => {
        try {
            const rootFiles = await readdir(process.cwd());
            const match = rootFiles.find((f) => f.toLowerCase() === 'api_discovery.md');
            if (match) {
                const content = await readFile(join(process.cwd(), match), 'utf8');
                log.info(`Loaded API discovery from ${match}`);
                return content;
            }
        } catch (e) {
            log.warning(`Failed to search or load API discovery file: ${e.message}`);
        }
        return null;
    };

    const PARAM_TYPE_VALUES = new Set([
        'int',
        'integer',
        'string',
        'boolean',
        'bool',
        'float',
        'number',
        'no',
        'yes',
        'true',
        'false',
    ]);

    /** Parse API_DISCOVERY.md with fully case-insensitive key/field matching. */
    const parseDiscoveryFile = (content) => {
        const result = { endpoint: null, method: 'GET', headers: {}, params: {}, fields: {} };
        if (!content) return result;
        const lines = content.split(/\r?\n/);
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            let rawKey = '';
            let rawVal = '';
            if (line.startsWith('|')) {
                const parts = line.split('|').map((p) => p.trim()).filter(Boolean);
                if (parts.length >= 2) {
                    if (parts[0].includes('---')) continue;
                    rawKey = parts[0];
                    rawVal = parts[1];
                    const tableKey = rawKey.toLowerCase();
                    // Only read endpoint/method/auth from markdown tables — skip param doc rows
                    // (e.g. "| page | int | no | ..." must not map page -> int).
                    if (tableKey === 'endpoint' || tableKey === 'url' || tableKey === 'api_url' || tableKey === 'api url') {
                        if (/^https?:\/\//i.test(rawVal)) result.endpoint = rawVal;
                    } else if (tableKey === 'method' || tableKey === 'http_method' || tableKey === 'http method') {
                        result.method = rawVal.toUpperCase();
                    }
                }
                continue;
            } else {
                const clean = line.replace(/^[-*+]\s*/, '').trim();
                const colonIdx = clean.indexOf(':');
                if (colonIdx === -1) continue;
                rawKey = clean.slice(0, colonIdx).trim();
                rawVal = clean.slice(colonIdx + 1).trim();
            }
            const keyLower = rawKey.toLowerCase();
            if (keyLower === 'endpoint' || keyLower === 'url' || keyLower === 'api_url' || keyLower === 'api url') {
                if (/^https?:\/\//i.test(rawVal)) result.endpoint = rawVal;
            } else if (keyLower === 'method' || keyLower === 'http_method' || keyLower === 'http method') {
                result.method = rawVal.toUpperCase();
            } else if (keyLower.startsWith('param') || keyLower.startsWith('query')) {
                const paramName = keyLower.replace(/^(parameter|param|query_param|query param|query)\s+/, '').trim();
                result.params[paramName] = rawVal;
            } else if (keyLower.startsWith('header')) {
                const headerName = keyLower.replace(/^header\s+/, '').trim();
                result.headers[headerName] = rawVal;
            } else if (keyLower.startsWith('field') || keyLower.startsWith('response') || keyLower.startsWith('mapping')) {
                const fieldName = keyLower.replace(/^(field|response_field|response field|response|mapping)\s+/, '').trim();
                result.fields[fieldName] = rawVal;
            } else if (['keyword', 'location', 'page', 'results_wanted', 'max_pages'].includes(keyLower)) {
                result.params[keyLower] = rawVal;
            } else if (['user-agent', 'accept', 'content-type', 'authorization', 'referer'].includes(keyLower)) {
                result.headers[keyLower] = rawVal;
            } else if (
                [
                    'title',
                    'employer',
                    'employer_name',
                    'company',
                    'salary',
                    'type',
                    'contract_type',
                    'postdate',
                    'date_posted',
                    'closedate',
                    'closing_date',
                    'reference',
                    'location',
                ].includes(keyLower)
            ) {
                result.fields[keyLower] = rawVal;
            }
        }
        return result;
    };

    const discoveryContent = await loadApiDiscovery();
    const discovery = parseDiscoveryFile(discoveryContent);

    const proxyConf = proxyConfiguration
        ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
        : undefined;

    const fixEncoding = (v) =>
        v
            ? String(v)
                  .replace(/\u00c2\u00a3/g, '\u00a3')
                  .replace(/\u00c2/g, '')
                  .replace(/&amp;/g, '&')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()
            : null;

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
        } catch {
            return v;
        }
    };

    const sanitizeHtml = (html) => {
        if (!html) return null;
        const $s = cheerioLoad(`<div id="r">${html}</div>`, { decodeEntities: false });
        const $r = $s('#r');
        $r.find(
            'script, style, noscript, iframe, svg, canvas, form, button, input, select, textarea, nav, header, footer, aside, img, picture, video, audio, source, .show-mobile, .forms-wrapper-white, .nhsuk-action-link, .save-job, .nhsuk-button, .nhs-open-job-inset',
        ).remove();
        $r.find('*').each((_, el) => {
            const tag = el.tagName?.toLowerCase();
            if (!tag || !new Set(['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'br', 'strong', 'em', 'b', 'i', 'a']).has(tag)) {
                $s(el).replaceWith($s(el).contents());
            } else {
                const attrs = el.attribs || {};
                for (const k of Object.keys(attrs)) if (k !== 'href' || tag !== 'a') $s(el).removeAttr(k);
            }
        });
        const out = $r.html()?.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        return out ? fixEncoding(out) : null;
    };

    const toText = (html) => {
        if (!html) return null;
        const $t = cheerioLoad(`<div id="r">${html}</div>`, { decodeEntities: true });
        const lines = [];
        $t('#r')
            .find('h2,h3,h4,p,li')
            .filter((_, el) => $t(el).parents('h2,h3,h4,p,li').length === 0)
            .each((_, el) => {
                const t = $t(el).text().replace(/\s+/g, ' ').trim();
                if (t) lines.push(el.tagName.toLowerCase() === 'li' ? `- ${t}` : t);
            });
        return lines.join('\n\n').trim() || null;
    };

    const firstText = ($, selector) => squash($(selector).first().text());
    const joinFields = ($, selectors) => {
        const parts = selectors.map((selector) => firstText($, selector)).filter(Boolean);
        return parts.length ? squash(parts.join(', ')) : null;
    };

    /** Resolve a param name from discovery map case-insensitively, falling back to defaultName. */
    const getDiscoveryParamName = (paramsMap, defaultName) => {
        const target = defaultName.toLowerCase();
        for (const [k, v] of Object.entries(paramsMap)) {
            if (k.toLowerCase() !== target) continue;
            const mapped = String(v || '').trim();
            if (!mapped || PARAM_TYPE_VALUES.has(mapped.toLowerCase())) return defaultName;
            return mapped;
        }
        return defaultName;
    };

    const keywordParamName = getDiscoveryParamName(discovery.params, 'keyword');
    const locationParamName = getDiscoveryParamName(discovery.params, 'location');
    const pageParamName = getDiscoveryParamName(discovery.params, 'page');

    const buildUrl = (p = 1) => {
        if (cleanStartUrl && p === 1) return cleanStartUrl;
        const apiBase = discovery.endpoint || API_BASE_URL;
        let u;
        try {
            u = new URL(apiBase);
        } catch {
            log.warning(`Invalid API endpoint in discovery: ${apiBase}. Using default.`);
            u = new URL(API_BASE_URL);
        }
        if (cleanKeyword) u.searchParams.set(keywordParamName, cleanKeyword);
        if (cleanLocation) u.searchParams.set(locationParamName, cleanLocation);
        u.searchParams.set(pageParamName, String(p));
        return u.href;
    };

    // Normalize discovery header keys to lowercase
    const normalizedHeaders = {};
    if (discovery.headers) {
        for (const [k, v] of Object.entries(discovery.headers)) {
            normalizedHeaders[k.toLowerCase()] = v;
        }
    }

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
        maxConcurrency: 5,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 60,
        requestQueue,
        async requestHandler({ request, crawler: c }) {
            const { label, page = 1, fromList } = request.userData;

            if (label === 'LIST') {
                // Await proxy URL properly - proxyConf.newUrl() is async, must be awaited
                const proxyUrl = (await proxyConf?.newUrl()) ?? undefined;
                let body;
                try {
                    ({ body } = await fetchWithRetry(request.url, {
                        proxyUrl,
                        headers: {
                            'user-agent': 'Mozilla/5.0 (compatible; NHS-Scraper/1.0)',
                            accept: 'application/xml, text/xml, */*',
                            ...normalizedHeaders,
                        },
                        timeout: { request: 15000 },
                    }));
                } catch (err) {
                    log.warning(`LIST page ${page} fetch failed - skipping: ${err.message}`);
                    return;
                }

                if (!body || typeof body !== 'string' || body.trim().length === 0) {
                    log.warning(`LIST page ${page} returned empty body - skipping`);
                    return;
                }

                const $l = cheerioLoad(body, { xmlMode: true });
                const jobs = [];

                // Case-insensitive child text extraction for API discovery compatibility
                const childText = ($el, tagName) => {
                    const lower = tagName.toLowerCase();
                    let val = $el.children(tagName).text();
                    if (!val) {
                        val = $el
                            .find('*')
                            .filter((_, n) => n.tagName?.toLowerCase() === lower)
                            .first()
                            .text();
                    }
                    return val || '';
                };

                const $vacancies = $l('vacancyDetails, vacancydetails');
                const rawCount = $vacancies.length;

                // Match top-level vacancyDetails only (avoid nested duplicates)
                $vacancies.each((_, el) => {
                    try {
                        const $v = $l(el);
                        const ref = squash(childText($v, 'reference'));
                        const rawJobUrl = childText($v, 'url')?.replace('beta.jobs.nhs.uk', 'www.jobs.nhs.uk');
                        const jobUrl = normalizeUrl(rawJobUrl) || rawJobUrl || null;
                        if (!ref) return;
                        if (seen.has(ref)) return;
                        seen.add(ref);
                        jobs.push({
                            title: squash(childText($v, 'title')),
                            company: squash(childText($v, 'employer')),
                            salary: squash(childText($v, 'salary')),
                            contract_type: squash(childText($v, 'type')),
                            date_posted: formatDate(childText($v, 'postDate') || childText($v, 'postdate')),
                            closing_date: formatDate(childText($v, 'closeDate') || childText($v, 'closedate')),
                            reference: ref,
                            url: jobUrl,
                            location: squash(childText($v, 'location')),
                        });
                    } catch (itemErr) {
                        log.warning(`Skipping malformed vacancy entry: ${itemErr.message}`);
                    }
                });

                log.info(`Found ${jobs.length} jobs on page ${page} (${rawCount} in API response)`);

                const remaining = Math.max(0, RESULTS_WANTED - (saved + batch.length + scheduledDetails));
                const toProc = jobs.slice(0, remaining);
                if (collectDetails) {
                    const detailRequests = toProc
                        .filter((job) => job.url)
                        .map((job) => ({ url: job.url, userData: { label: 'DETAIL', fromList: job } }));
                    scheduledDetails += detailRequests.length;
                    await c.addRequests(detailRequests);
                    for (const job of toProc.filter((j) => !j.url)) {
                        batch.push(job);
                    }
                } else {
                    batch.push(...toProc);
                    if (batch.length >= BATCH_SIZE) await flush();
                }

                const hasCapacity = saved + batch.length + scheduledDetails < RESULTS_WANTED;
                if (hasCapacity && page < MAX_PAGES && rawCount >= 10) {
                    await c.addRequests([{ url: buildUrl(page + 1), userData: { label: 'LIST', page: page + 1 } }]);
                }
                return;
            }

            if (label === 'DETAIL') {
                try {
                    // Await proxy URL properly
                    const proxyUrl = (await proxyConf?.newUrl()) ?? undefined;
                    let detailBody;
                    try {
                        ({ body: detailBody } = await fetchWithRetry(request.url, {
                            proxyUrl,
                            headers: {
                                'user-agent':
                                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                                ...normalizedHeaders,
                            },
                            timeout: { request: 15000 },
                        }));
                    } catch (fetchErr) {
                        log.warning(`DETAIL fetch failed - skipping ${request.url}: ${fetchErr.message}`);
                        scheduledDetails = Math.max(0, scheduledDetails - 1);
                        // Fall back to list-only data so we still produce some output
                        const lFallback = fromList || {};
                        if (lFallback.reference && Object.keys(lFallback).length > 1) {
                            batch.push(lFallback);
                            if (batch.length >= BATCH_SIZE) await flush();
                        }
                        return;
                    }

                    const $d = cheerioLoad(detailBody || '');
                    const l = fromList || {};
                    const wrap = $d('div.nhsuk-grid-column-two-thirds.wrap-paragraphs, div.wrap-paragraphs').first();
                    const dHtml = sanitizeHtml(wrap.html());

                    const item = {
                        title: firstText($d, '#heading') || l.title,
                        company: firstText($d, '#employer_name') || l.company,
                        location:
                            joinFields($d, [
                                '#employer_address_line_1',
                                '#employer_address_line_2',
                                '#employer_address_line_3',
                                '#employer_town',
                                '#employer_county',
                                '#employer_postcode',
                            ]) || l.location,
                        salary:
                            firstText($d, '#range_salary') ||
                            firstText($d, '#fixed_salary') ||
                            firstText($d, '#salary') ||
                            l.salary,
                        contract_type: firstText($d, '#contract_type') || l.contract_type,
                        working_pattern:
                            squash($d('#working_pattern_heading').first().next('p').first().text()) ||
                            l.working_pattern,
                        date_posted: l.date_posted,
                        closing_date: l.closing_date,
                        reference: l.reference || firstText($d, '#trac-job-reference'),
                        description_html: dHtml,
                        description_text: toText(dHtml),
                        url: request.url,
                    };

                    const clean = {};
                    for (const k of [
                        'title',
                        'company',
                        'location',
                        'salary',
                        'contract_type',
                        'working_pattern',
                        'date_posted',
                        'closing_date',
                        'reference',
                        'url',
                        'description_html',
                        'description_text',
                    ]) {
                        if (item[k]) clean[k] = item[k];
                    }

                    batch.push(clean);
                    scheduledDetails = Math.max(0, scheduledDetails - 1);
                    if (batch.length >= BATCH_SIZE) await flush();
                } catch (detailErr) {
                    log.warning(`DETAIL handler error - skipping ${request.url}: ${detailErr.message}`);
                    scheduledDetails = Math.max(0, scheduledDetails - 1);
                }
            }
        },
    });

    await requestQueue.addRequest({ url: buildUrl(1), userData: { label: 'LIST', page: 1 } });
    await crawler.run();
    await flush();
    log.info(`Scraping completed. Total: ${saved}`);
});
