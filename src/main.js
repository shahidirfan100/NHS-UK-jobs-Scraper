// NHS UK Jobs Scraper - JSON-first with HTML fallback
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';
import { gotScraping } from 'got-scraping';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            keyword = '',
            location = '',
            distance = '',
            contractType = '',
            workingPattern = '',
            staffGroup = '',
            payRange = '',
            results_wanted: RESULTS_WANTED_RAW = 100,
            max_pages: MAX_PAGES_RAW = 50,
            collectDetails = true,
            startUrl,
            startUrls,
            url,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 50;
        const BASE_URL = 'https://www.jobs.nhs.uk';
        const DEFAULT_HEADERS = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept-Language': 'en-GB,en;q=0.9',
        };

        const toAbs = (href, base = BASE_URL) => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const toText = (val) => {
            if (!val) return null;
            const text = String(val).replace(/\s+/g, ' ').trim();
            return text || null;
        };

        const squashRepeats = (val) => {
            let t = toText(val);
            if (!t) return null;

            // If the string is exactly two identical halves, keep one.
            if (t.length % 2 === 0) {
                const half = t.length / 2;
                const first = t.slice(0, half).trim();
                const second = t.slice(half).trim();
                if (first && first === second) t = first;
            }

            // Collapse repeated phrase separated by whitespace (e.g., "Full-time Full-time").
            const repeatPhrase = t.match(/^(.{3,})\s+\1$/);
            if (repeatPhrase) t = repeatPhrase[1].trim();

            // Collapse immediate duplicate tokens.
            const tokens = t.split(/\s+/);
            const collapsed = [];
            for (const tok of tokens) {
                if (!collapsed.length || collapsed[collapsed.length - 1] !== tok) collapsed.push(tok);
            }
            t = collapsed.join(' ').trim();
            return t || null;
        };

        const normalizeValue = (val) => squashRepeats(val);

        const cleanText = (html) => {
            if (!html) return '';
            const $ = cheerioLoad(html);
            $('script, style, noscript, iframe').remove();
            return $.root().text().replace(/\s+/g, ' ').trim();
        };

        const firstNonEmpty = (...vals) => {
            for (const v of vals) {
                const normalized = toText(v);
                if (normalized) return normalized;
            }
            return null;
        };

        const buildStartUrl = (kw, loc, dist, contract, pattern, staff, pay) => {
            const u = new URL(`${BASE_URL}/candidate/search/results`);
            if (kw) u.searchParams.set('keyword', String(kw).trim());
            if (loc) u.searchParams.set('location', String(loc).trim());
            if (dist) u.searchParams.set('distance', String(dist).trim());
            if (contract) u.searchParams.set('contractType', String(contract).trim());
            if (pattern) u.searchParams.set('workingPattern', String(pattern).trim());
            if (staff) u.searchParams.set('staffGroup', String(staff).trim());
            if (pay) u.searchParams.set('salaryRange', String(pay).trim());
            return u.href;
        };

        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) {
            initial.push(buildStartUrl(keyword, location, distance, contractType, workingPattern, staffGroup, payRange));
        }

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

        let saved = 0;
        let scheduledDetails = 0;
        const seenUrls = new Set();

        // Try to fetch JSON API first (priority approach)
        async function tryFetchJsonApi(searchUrl, pageNum = 1) {
            try {
                const urlObj = new URL(searchUrl);
                urlObj.searchParams.set('page', pageNum);
                
                const response = await gotScraping({
                    url: urlObj.href,
                    headers: {
                        'Accept': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        ...DEFAULT_HEADERS,
                    },
                    proxyUrl: proxyConf?.newUrl(),
                    responseType: 'json',
                });

                if (response.body && typeof response.body === 'object') {
                    log.info(`JSON API successful for page ${pageNum}`);
                    return response.body;
                }
            } catch (err) {
                log.debug(`JSON API not available: ${err.message}`);
            }
            return null;
        }

        function extractFromJsonLd($) {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const parsed = JSON.parse($(scripts[i]).html() || '');
                    const arr = Array.isArray(parsed) ? parsed : [parsed];
                    for (const e of arr) {
                        if (!e) continue;
                        const t = e['@type'] || e.type;
                        if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) {
                            return {
                                title: firstNonEmpty(e.title, e.name),
                                company: firstNonEmpty(e.hiringOrganization?.name),
                                date_posted: toText(e.datePosted),
                                description_html: e.description || null,
                                location: firstNonEmpty(
                                    e.jobLocation?.address ? [
                                        e.jobLocation.address.addressLocality,
                                        e.jobLocation.address.addressRegion,
                                        e.jobLocation.address.postalCode,
                                    ].filter(Boolean).join(', ') : null,
                                    e.jobLocation?.name,
                                ),
                                salary: firstNonEmpty(
                                    e.baseSalary?.value?.value,
                                    e.baseSalary?.value?.minValue && e.baseSalary?.value?.maxValue
                                        ? `${e.baseSalary.value.minValue} to ${e.baseSalary.value.maxValue} ${e.baseSalary.value.currency || ''}`
                                        : null,
                                ),
                                job_type: firstNonEmpty(e.employmentType),
                                closing_date: toText(e.validThrough || e.expires),
                            };
                        }
                    }
                } catch (e) { /* ignore */ }
            }
            return null;
        }

        function extractJobsFromHtml($, baseUrl) {
            const jobs = [];
            
            $('li.search-result, article.search-result, div.search-result').each((_, elem) => {
                const $elem = $(elem);
                const titleEl = $elem.find('[data-test="search-result-job-title"], h2 a, h3 a, a[href*="/candidate/jobadvert/"]').first();
                const title = normalizeValue(titleEl.text());
                const href = titleEl.attr('href');
                
                if (title && href) {
                    const jobUrl = toAbs(href, baseUrl);
                    if (jobUrl && !seenUrls.has(jobUrl)) {
                        seenUrls.add(jobUrl);
                        
                        const orgBlock = $elem.find('[data-test="search-result-location"] h3').first();
                        const company = normalizeValue(firstNonEmpty(
                            orgBlock.clone().children().remove().end().text(),
                            $elem.find('[data-test="search-result-location"]').text(),
                            $elem.find('[class*="employer"], [class*="organisation"]').first().text(),
                        ));
                        const location = normalizeValue(firstNonEmpty(
                            orgBlock.find('.location-font-size').text(),
                            $elem.find('[data-test="search-result-location"] .location-font-size').text(),
                            $elem.find('[class*="location"]').first().text(),
                        ));
                        const salary = normalizeValue(firstNonEmpty(
                            $elem.find('[data-test="search-result-salary"] strong').first().text(),
                            $elem.find('[class*="salary"]').first().text(),
                        ));
                        const datePosted = normalizeValue(firstNonEmpty(
                            $elem.find('[data-test="search-result-publicationDate"] strong').first().text(),
                            $elem.find('time[datetime]').first().attr('datetime'),
                        ));
                        const closingDate = normalizeValue(firstNonEmpty(
                            $elem.find('[data-test="search-result-closingDate"] strong').first().text(),
                            $elem.find('[class*="closing"]').first().text(),
                        ));
                        const contractType = normalizeValue(firstNonEmpty(
                            $elem.find('[data-test="search-result-jobType"] strong').first().text(),
                            $elem.find('[data-test="search-result-contractType"] strong').first().text(),
                            $elem.find('[class*="contract"]').first().text(),
                        ));
                        const workingPattern = normalizeValue(firstNonEmpty(
                            $elem.find('[data-test="search-result-workingPattern"] strong').first().text(),
                            $elem.find('[class*="working-pattern"], [class*="hours"]').first().text(),
                        ));
                        
                        jobs.push({
                            title,
                            company,
                            location,
                            salary,
                            contract_type: contractType,
                            working_pattern: workingPattern,
                            date_posted: datePosted,
                            closing_date: closingDate,
                            url: jobUrl,
                        });
                    }
                }
            });

            // Fallback: find all job links
            if (jobs.length === 0) {
                $('a[href*="/candidate/jobadvert/"]').each((_, a) => {
                    const href = $(a).attr('href');
                    const jobUrl = toAbs(href, baseUrl);
                    if (jobUrl && !seenUrls.has(jobUrl)) {
                        seenUrls.add(jobUrl);
                        const title = normalizeValue(firstNonEmpty($(a).text(), $(a).attr('title')));
                        if (title) {
                            jobs.push({ title, url: jobUrl });
                        }
                    }
                });
            }

            return jobs;
        }

        function findNextPage($, currentUrl, currentPage) {
            // Look for pagination links
            const nextLink = $('a.nhsuk-pagination__link--next, a[rel="next"], a[aria-label*="next"], a:contains("Next")').first();
            if (nextLink.length) {
                const href = nextLink.attr('href');
                if (href) return toAbs(href, currentUrl);
            }

            // Build next page URL manually
            const urlObj = new URL(currentUrl);
            const nextPageNum = currentPage + 1;
            urlObj.searchParams.set('page', nextPageNum);
            return urlObj.href;
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 6,
            requestHandlerTimeoutSecs: 90,
            additionalMimeTypes: ['application/json'],
            preNavigationHooks: [
                async ({ request }) => {
                    request.headers = {
                        ...DEFAULT_HEADERS,
                        ...(request.headers || {}),
                    };
                },
            ],
            
            async requestHandler({ request, $, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;
                const fromList = request.userData?.fromList;

                if (label === 'LIST') {
                    crawlerLog.info(`Processing page ${pageNo}: ${request.url}`);

                    // Try JSON API first
                    const jsonData = await tryFetchJsonApi(request.url, pageNo);
                    
                    let jobs = [];
                    if (jsonData?.results?.length) {
                        // Process JSON API response
                        jobs = jsonData.results.map(job => ({
                            title: normalizeValue(job.title),
                            company: normalizeValue(job.employer || job.organisation || job.company),
                            location: normalizeValue(job.location || job.jobLocation),
                            salary: normalizeValue(job.salary || job.payRange),
                            contract_type: normalizeValue(job.contractType || job.contract),
                            working_pattern: normalizeValue(job.workingPattern || job.workingHours),
                            date_posted: normalizeValue(job.datePosted || job.postedDate),
                            closing_date: normalizeValue(job.closingDate || job.deadline),
                            reference: job.reference || job.jobReference || job.referenceNumber || null,
                            url: toAbs(job.url || job.link || job.jobUrl || job.href),
                        }));
                        crawlerLog.info(`JSON API returned ${jobs.length} jobs`);
                    } else {
                        // Fallback to HTML parsing
                        jobs = extractJobsFromHtml($, request.url);
                        crawlerLog.info(`HTML parsing found ${jobs.length} jobs`);
                    }

                    if (collectDetails) {
                        const remaining = RESULTS_WANTED - (saved + scheduledDetails);
                        const toEnqueue = jobs
                            .filter(j => j.url)
                            .slice(0, Math.max(0, remaining));
                        if (toEnqueue.length) {
                            const requests = toEnqueue.map(j => ({
                                url: j.url,
                                userData: { label: 'DETAIL', fromList: j },
                                headers: DEFAULT_HEADERS,
                            }));
                            await crawler.addRequests(requests);
                            scheduledDetails += toEnqueue.length;
                        }
                    } else {
                        const remaining = RESULTS_WANTED - saved;
                        const toPush = jobs.slice(0, Math.max(0, remaining));
                        if (toPush.length) {
                            await Dataset.pushData(toPush);
                            saved += toPush.length;
                            crawlerLog.info(`Saved ${toPush.length} jobs (total: ${saved})`);
                        }
                    }

                    // Handle pagination
                    if ((saved + scheduledDetails) < RESULTS_WANTED && pageNo < MAX_PAGES) {
                        const nextUrl = findNextPage($, request.url, pageNo);
                        if (nextUrl) {
                            await crawler.addRequests([{
                                url: nextUrl,
                                userData: { label: 'LIST', pageNo: pageNo + 1 },
                                headers: DEFAULT_HEADERS,
                            }]);
                            crawlerLog.info(`Enqueued next page: ${pageNo + 1}`);
                        } else {
                            crawlerLog.info('No more pages found');
                        }
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) return;
                    
                    try {
                        const jsonLdData = extractFromJsonLd($);
                        const data = jsonLdData || {};

                        const addressParts = [
                            '#employer_address_line_1',
                            '#employer_address_line_2',
                            '#employer_address_line_3',
                            '#employer_town',
                            '#employer_postcode',
                        ].map(sel => normalizeValue($(sel).text())).filter(Boolean);

                        const uniqueParts = [];
                        const seenParts = new Set();
                        for (const part of addressParts) {
                            if (!seenParts.has(part)) {
                                uniqueParts.push(part);
                                seenParts.add(part);
                            }
                        }

                        if (!data.title) {
                            data.title = normalizeValue(firstNonEmpty(
                                $('#heading').first().text(),
                                $('h1, [class*="job-title"]').first().text(),
                                fromList?.title,
                            ));
                        }
                        
                        if (!data.company) {
                            data.company = normalizeValue(firstNonEmpty(
                                $('#employer_name').text(),
                                $('[class*="employer"], [class*="organisation"]').first().text(),
                                fromList?.company,
                            ));
                        }

                        if (!data.location) {
                            data.location = normalizeValue(firstNonEmpty(
                                uniqueParts.join(', '),
                                $('[class*="location"]').text(),
                                fromList?.location,
                            ));
                        }

                        if (!data.salary) {
                            data.salary = normalizeValue(firstNonEmpty(
                                $('#fixed_salary').text(),
                                $('#salary').text(),
                                fromList?.salary,
                            ));
                        }

                        if (!data.date_posted) {
                            data.date_posted = normalizeValue(firstNonEmpty(
                                $('time[datetime]').first().attr('datetime'),
                                fromList?.date_posted,
                            ));
                        }

                        const closingDate = normalizeValue(firstNonEmpty(
                            $('#closing_date').text()?.replace(/the closing date is/i, ''),
                            $('[class*="closing-date"]').text(),
                            fromList?.closing_date,
                        ));
                        
                        if (!data.job_type) {
                            data.job_type = normalizeValue(firstNonEmpty(
                                $('#contract_type').text(),
                                $('[class*="contract-type"]').first().text(),
                                fromList?.contract_type,
                            ));
                        }

                        const workingPattern = normalizeValue(firstNonEmpty(
                            $('#working_pattern_heading').next('p').text(),
                            $('[class*="working-pattern"]').first().text(),
                            fromList?.working_pattern,
                        ));
                        
                        // Extract description
                        if (!data.description_html) {
                            const descriptionChunks = [];
                            const selectors = [
                                '#job_description',
                                '#job_description_text',
                                '#job_description_content',
                                '#job-profile-section',
                                '#job_profile_section',
                                '#job-summary',
                                '#job_summary',
                                '#main_duties',
                                '#main-duties',
                                '#person_specification',
                                'section[class*="job-description"]',
                                'div[class*="job-description"]',
                                '#job-description',
                                '.description',
                            ];
                            for (const sel of selectors) {
                                const el = $(sel).first();
                                if (el && el.length) {
                                    const html = el.html();
                                    if (html && toText(html)) descriptionChunks.push(html.trim());
                                }
                            }
                            if (descriptionChunks.length) {
                                data.description_html = descriptionChunks.join('\n');
                            }
                        }

                        data.description_text = data.description_html ? cleanText(data.description_html) : null;

                        // Extract reference number
                        const reference = firstNonEmpty(
                            $('#trac-job-reference').text(),
                            $('[class*="reference"]').first().text(),
                            fromList?.reference,
                        );

                        const item = {
                            title: normalizeValue(data.title || fromList?.title),
                            company: normalizeValue(data.company || fromList?.company),
                            location: normalizeValue(data.location || fromList?.location),
                            salary: normalizeValue(data.salary || fromList?.salary),
                            contract_type: normalizeValue(data.job_type || fromList?.contract_type),
                            working_pattern: normalizeValue(workingPattern || fromList?.working_pattern),
                            date_posted: normalizeValue(data.date_posted || fromList?.date_posted),
                            closing_date: closingDate || null,
                            reference: normalizeValue(reference || fromList?.reference),
                            description_html: data.description_html || null,
                            description_text: data.description_text || null,
                            url: request.url,
                        };

                        await Dataset.pushData(item);
                        saved++;
                        crawlerLog.info(`Saved job detail (${saved}/${RESULTS_WANTED}): ${item.title}`);
                    } catch (err) {
                        crawlerLog.error(`Failed to process ${request.url}: ${err.message}`);
                    } finally {
                        scheduledDetails = Math.max(0, scheduledDetails - 1);
                    }
                }
            },
        });

        await crawler.run(initial.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 1 } })));
        log.info(`Scraping completed. Total jobs saved: ${saved}`);
        
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
