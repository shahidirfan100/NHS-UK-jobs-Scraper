// NHS UK Jobs Scraper - Modern implementation with JSON API + HTML fallback
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

        const toAbs = (href, base = BASE_URL) => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const cleanText = (html) => {
            if (!html) return '';
            const $ = cheerioLoad(html);
            $('script, style, noscript, iframe').remove();
            return $.root().text().replace(/\s+/g, ' ').trim();
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
                                title: e.title || e.name || null,
                                company: e.hiringOrganization?.name || null,
                                date_posted: e.datePosted || null,
                                description_html: e.description || null,
                                location: e.jobLocation?.address?.addressLocality || e.jobLocation?.address?.addressRegion || null,
                                salary: e.baseSalary?.value?.value || e.baseSalary?.currency || null,
                                job_type: e.employmentType || null,
                            };
                        }
                    }
                } catch (e) { /* ignore */ }
            }
            return null;
        }

        function extractJobsFromHtml($, baseUrl) {
            const jobs = [];
            
            // NHS Jobs specific selectors
            $('article.search-result, div[class*="vacancy"], li[class*="job"]').each((_, elem) => {
                const $elem = $(elem);
                const titleEl = $elem.find('h2 a, h3 a, a[class*="job-title"]').first();
                const title = titleEl.text().trim();
                const href = titleEl.attr('href');
                
                if (title && href) {
                    const jobUrl = toAbs(href, baseUrl);
                    if (jobUrl && !seenUrls.has(jobUrl)) {
                        seenUrls.add(jobUrl);
                        
                        const company = $elem.find('h3, [class*="employer"], [class*="organisation"]').first().text().trim() || null;
                        const location = $elem.find('[class*="location"]').first().text().trim() || null;
                        const salary = $elem.find('[class*="salary"], dd:contains("Salary")').first().text().trim() || null;
                        const datePosted = $elem.find('[class*="posted"], time').first().text().trim() || null;
                        const contractType = $elem.find('[class*="contract"]').first().text().trim() || null;
                        const workingPattern = $elem.find('[class*="working-pattern"], [class*="hours"]').first().text().trim() || null;
                        
                        jobs.push({
                            title,
                            company,
                            location,
                            salary,
                            contract_type: contractType,
                            working_pattern: workingPattern,
                            date_posted: datePosted,
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
                        const title = $(a).text().trim() || $(a).attr('title') || null;
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
            const nextLink = $('a:contains("Next"), a[rel="next"], a[aria-label*="next"]').first();
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
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 90,
            
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    crawlerLog.info(`Processing page ${pageNo}: ${request.url}`);

                    // Try JSON API first
                    const jsonData = await tryFetchJsonApi(request.url, pageNo);
                    
                    let jobs = [];
                    if (jsonData && jsonData.results) {
                        // Process JSON API response
                        jobs = jsonData.results.map(job => ({
                            title: job.title || null,
                            company: job.employer || job.organisation || null,
                            location: job.location || null,
                            salary: job.salary || null,
                            contract_type: job.contractType || null,
                            working_pattern: job.workingPattern || null,
                            job_type: job.jobType || null,
                            date_posted: job.datePosted || job.closingDate || null,
                            url: toAbs(job.url || job.link || job.jobUrl),
                            reference: job.reference || job.jobReference || null,
                        }));
                        crawlerLog.info(`JSON API returned ${jobs.length} jobs`);
                    } else {
                        // Fallback to HTML parsing
                        jobs = extractJobsFromHtml($, request.url);
                        crawlerLog.info(`HTML parsing found ${jobs.length} jobs`);
                    }

                    if (collectDetails) {
                        const remaining = RESULTS_WANTED - saved;
                        const toEnqueue = jobs.slice(0, Math.max(0, remaining));
                        if (toEnqueue.length) {
                            await enqueueLinks({
                                urls: toEnqueue.map(j => j.url),
                                userData: { label: 'DETAIL', listData: toEnqueue }
                            });
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
                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES) {
                        const nextUrl = findNextPage($, request.url, pageNo);
                        if (nextUrl) {
                            await enqueueLinks({
                                urls: [nextUrl],
                                userData: { label: 'LIST', pageNo: pageNo + 1 }
                            });
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
                        // Try JSON-LD first
                        const jsonLdData = extractFromJsonLd($);
                        const data = jsonLdData || {};

                        // Extract job details from HTML
                        if (!data.title) {
                            data.title = $('h1, [class*="job-title"]').first().text().trim() || null;
                        }
                        
                        if (!data.company) {
                            data.company = $('h2:contains("Organisation"), [class*="employer"], [class*="organisation"]')
                                .first().text().replace(/organisation/i, '').trim() || null;
                        }

                        if (!data.location) {
                            data.location = $('dd:contains("Location"), [class*="location"]').text().trim() || null;
                        }

                        if (!data.salary) {
                            data.salary = $('dd:contains("Salary"), [class*="salary"]').text().trim() || null;
                        }

                        if (!data.date_posted) {
                            data.date_posted = $('dd:contains("posted"), time[datetime]').first().text().trim() ||
                                             $('time[datetime]').first().attr('datetime') || null;
                        }

                        const closingDate = $('dd:contains("Closing"), [class*="closing-date"]').first().text().trim() || null;
                        
                        if (!data.job_type) {
                            data.job_type = $('dd:contains("Contract"), [class*="contract-type"]').first().text().trim() || null;
                        }

                        const workingPattern = $('dd:contains("Working pattern"), [class*="working-pattern"]').first().text().trim() || null;
                        
                        // Extract description
                        if (!data.description_html) {
                            const descSection = $('section[class*="job-description"], div[class*="job-description"], #job-description, .description').first();
                            data.description_html = descSection && descSection.length ? descSection.html()?.trim() : null;
                        }

                        data.description_text = data.description_html ? cleanText(data.description_html) : null;

                        // Extract reference number
                        const reference = $('dd:contains("Reference"), [class*="reference"]').first().text().trim() || null;

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
                    }
                }
            },
        });

        await crawler.run(initial.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 1 } })));
        log.info(`✓ Scraping completed. Total jobs saved: ${saved}`);
        
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
