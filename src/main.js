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
                const title = toText(titleEl.text());
                const href = titleEl.attr('href');
                
                if (title && href) {
                    const jobUrl = toAbs(href, baseUrl);
                    if (jobUrl && !seenUrls.has(jobUrl)) {
                        seenUrls.add(jobUrl);
                        
                        const orgBlock = $elem.find('[data-test="search-result-location"] h3').first();
                        const company = firstNonEmpty(
                            orgBlock.clone().children().remove().end().text(),
                            $elem.find('[data-test="search-result-location"]').text(),
                            $elem.find('[class*="employer"], [class*="organisation"]').first().text(),
                        );
                        const location = firstNonEmpty(
                            orgBlock.find('.location-font-size').text(),
                            $elem.find('[data-test="search-result-location"] .location-font-size').text(),
                            $elem.find('[class*="location"]').first().text(),
                        );
                        const salary = firstNonEmpty(
                            $elem.find('[data-test="search-result-salary"] strong').first().text(),
                            $elem.find('[class*="salary"]').first().text(),
                        );
                        const datePosted = firstNonEmpty(
                            $elem.find('[data-test="search-result-publicationDate"] strong').first().text(),
                            $elem.find('time[datetime]').first().attr('datetime'),
                        );
                        const closingDate = firstNonEmpty(
                            $elem.find('[data-test="search-result-closingDate"] strong').first().text(),
                            $elem.find('[class*="closing"]').first().text(),
                        );
                        const contractType = firstNonEmpty(
                            $elem.find('[data-test="search-result-jobType"] strong').first().text(),
                            $elem.find('[data-test="search-result-contractType"] strong').first().text(),
                            $elem.find('[class*="contract"]').first().text(),
                        );
                        const workingPattern = firstNonEmpty(
                            $elem.find('[data-test="search-result-workingPattern"] strong').first().text(),
                            $elem.find('[class*="working-pattern"], [class*="hours"]').first().text(),
                        );
                        
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
                        const title = firstNonEmpty($(a).text(), $(a).attr('title'));
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
                            title: job.title || null,
                            company: job.employer || job.organisation || job.company || null,
                            location: job.location || job.jobLocation || null,
                            salary: job.salary || job.payRange || null,
                            contract_type: job.contractType || job.contract || null,
                            working_pattern: job.workingPattern || job.workingHours || null,
                            date_posted: job.datePosted || job.postedDate || null,
                            closing_date: job.closingDate || job.deadline || null,
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
                        ].map(sel => toText($(sel).text())).filter(Boolean);

                        if (!data.title) {
                            data.title = firstNonEmpty(
                                $('#heading').first().text(),
                                $('h1, [class*="job-title"]').first().text(),
                                fromList?.title,
                            );
                        }
                        
                        if (!data.company) {
                            data.company = firstNonEmpty(
                                $('#employer_name').text(),
                                $('[class*="employer"], [class*="organisation"]').first().text(),
                                fromList?.company,
                            );
                        }

                        if (!data.location) {
                            data.location = firstNonEmpty(
                                addressParts.join(', '),
                                $('[class*="location"]').text(),
                                fromList?.location,
                            );
                        }

                        if (!data.salary) {
                            data.salary = firstNonEmpty(
                                $('#fixed_salary').text(),
                                $('#salary').text(),
                                fromList?.salary,
                            );
                        }

                        if (!data.date_posted) {
                            data.date_posted = firstNonEmpty(
                                $('time[datetime]').first().attr('datetime'),
                                fromList?.date_posted,
                            );
                        }

                        const closingDate = firstNonEmpty(
                            $('#closing_date').text()?.replace(/the closing date is/i, ''),
                            $('[class*="closing-date"]').text(),
                            fromList?.closing_date,
                        );
                        
                        if (!data.job_type) {
                            data.job_type = firstNonEmpty(
                                $('#contract_type').text(),
                                $('[class*="contract-type"]').first().text(),
                                fromList?.contract_type,
                            );
                        }

                        const workingPattern = firstNonEmpty(
                            $('#working_pattern_heading').next('p').text(),
                            $('[class*="working-pattern"]').first().text(),
                            fromList?.working_pattern,
                        );
                        
                        // Extract description
                        if (!data.description_html) {
                            const descSection = $('#job_description, section[class*="job-description"], div[class*="job-description"], #job-description, .description').first();
                            data.description_html = descSection && descSection.length ? descSection.html()?.trim() : null;
                        }

                        data.description_text = data.description_html ? cleanText(data.description_html) : null;

                        // Extract reference number
                        const reference = firstNonEmpty(
                            $('#trac-job-reference').text(),
                            $('[class*="reference"]').first().text(),
                            fromList?.reference,
                        );

                        const item = {
                            title: data.title || null,
                            company: data.company || null,
                            location: data.location || null,
                            salary: data.salary || null,
                            contract_type: data.job_type || null,
                            working_pattern: workingPattern || null,
                            date_posted: data.date_posted || null,
                            closing_date: closingDate || null,
                            reference: reference || null,
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
