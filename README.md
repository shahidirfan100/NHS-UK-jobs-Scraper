# NHS UK Jobs Scraper

Extract comprehensive job listings from NHS Jobs UK with advanced search capabilities. This scraper automatically uses JSON API when available and seamlessly falls back to HTML parsing for maximum reliability and data quality.

## What does NHS UK Jobs Scraper do?

This scraper helps you extract structured job data from [NHS Jobs UK](https://www.jobs.nhs.uk/), the official recruitment platform for National Health Service positions across the United Kingdom.

**Key capabilities:**
- 🔍 Search by keyword, location, contract type, and working pattern
- 📊 Extract comprehensive job details including salary, closing dates, and descriptions
- ⚡ Fast and efficient with dual extraction methods (JSON API + HTML parsing)
- 🎯 Filter by NHS staff groups and pay bands
- 📍 Location-based search with configurable distance radius
- 🔄 Automatic pagination handling
- ✅ Clean, structured output ready for analysis

## Why use NHS UK Jobs Scraper?

<ul>
<li><strong>Dual Extraction Method:</strong> Prioritizes JSON API for speed, automatically falls back to HTML parsing for reliability</li>
<li><strong>Comprehensive Data:</strong> Captures job title, organisation, location, salary, contract details, descriptions, and more</li>
<li><strong>Flexible Search:</strong> Multiple filter options to find exactly the jobs you need</li>
<li><strong>Production Ready:</strong> Built with modern best practices, error handling, and deduplication</li>
<li><strong>No Setup Required:</strong> Run directly on Apify platform with zero configuration</li>
</ul>

## Use Cases

<dl>
<dt><strong>Healthcare Recruitment</strong></dt>
<dd>Build job boards, aggregate opportunities, or monitor specific positions across NHS trusts</dd>

<dt><strong>Market Research</strong></dt>
<dd>Analyze salary trends, demand for specialties, geographic distribution of healthcare jobs</dd>

<dt><strong>Career Planning</strong></dt>
<dd>Track job openings in specific locations, monitor closing dates, compare compensation packages</dd>

<dt><strong>Competitive Intelligence</strong></dt>
<dd>Monitor hiring trends, identify skill requirements, analyze workforce needs in healthcare sector</dd>
</dl>

## Input Configuration

The scraper accepts various input parameters to customize your job search:

### Search Parameters

<table>
<thead>
<tr>
<th>Field</th>
<th>Type</th>
<th>Description</th>
<th>Example</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>keyword</code></td>
<td>String</td>
<td>Search by job title, skill, or keyword</td>
<td>"nurse", "doctor", "administrator"</td>
</tr>
<tr>
<td><code>location</code></td>
<td>String</td>
<td>City, town, or postcode to search near</td>
<td>"London", "Manchester", "SW1A 1AA"</td>
</tr>
<tr>
<td><code>distance</code></td>
<td>String</td>
<td>Search radius in miles from location</td>
<td>"10", "20", "50"</td>
</tr>
<tr>
<td><code>contractType</code></td>
<td>String</td>
<td>Filter by contract type</td>
<td>"Permanent", "Fixed-Term", "Locum"</td>
</tr>
<tr>
<td><code>workingPattern</code></td>
<td>String</td>
<td>Filter by working pattern</td>
<td>"Full time", "Part time", "Flexible working"</td>
</tr>
<tr>
<td><code>staffGroup</code></td>
<td>String</td>
<td>NHS staff group filter</td>
<td>"Nursing and Midwifery"</td>
</tr>
<tr>
<td><code>payRange</code></td>
<td>String</td>
<td>Salary range or NHS pay band</td>
<td>"Band 5", "Band 6"</td>
</tr>
</tbody>
</table>

### Advanced Options

<table>
<thead>
<tr>
<th>Field</th>
<th>Type</th>
<th>Description</th>
<th>Default</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>startUrl</code></td>
<td>String</td>
<td>Start from a specific NHS Jobs search URL (overrides search parameters)</td>
<td>-</td>
</tr>
<tr>
<td><code>collectDetails</code></td>
<td>Boolean</td>
<td>Visit each job page for full descriptions (slower but more complete)</td>
<td>true</td>
</tr>
<tr>
<td><code>results_wanted</code></td>
<td>Integer</td>
<td>Maximum number of jobs to extract</td>
<td>100</td>
</tr>
<tr>
<td><code>max_pages</code></td>
<td>Integer</td>
<td>Maximum search result pages to process</td>
<td>50</td>
</tr>
<tr>
<td><code>proxyConfiguration</code></td>
<td>Object</td>
<td>Proxy settings (residential recommended)</td>
<td>Apify Proxy</td>
</tr>
</tbody>
</table>

## Input Example

```json
{
  "keyword": "registered nurse",
  "location": "London",
  "distance": "15",
  "contractType": "Permanent",
  "workingPattern": "Full time",
  "staffGroup": "Nursing and Midwifery",
  "payRange": "Band 5",
  "collectDetails": true,
  "results_wanted": 50,
  "max_pages": 10,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

### Quick Start Example

Minimal configuration to get started quickly:

```json
{
  "keyword": "nurse",
  "location": "Manchester",
  "results_wanted": 20
}
```

### Using Start URL

Skip the search form and start from a specific NHS Jobs URL:

```json
{
  "startUrl": "https://www.jobs.nhs.uk/candidate/search/results?keyword=paramedic&location=Birmingham",
  "collectDetails": true,
  "results_wanted": 30
}
```

## Output Data

The scraper provides comprehensive, structured job data in JSON format:

### Output Schema

```json
{
  "title": "Senior Staff Nurse - Emergency Department",
  "company": "NHS Greater Manchester Integrated Care",
  "location": "Manchester Royal Infirmary, Manchester M13 9WL",
  "salary": "£35,392 to £42,618 a year",
  "contract_type": "Permanent",
  "working_pattern": "Full time",
  "date_posted": "05 December 2024",
  "closing_date": "02 January 2025",
  "reference": "MRI-2024-12345",
  "description_html": "<p>We are seeking an experienced...</p>",
  "description_text": "We are seeking an experienced...",
  "url": "https://www.jobs.nhs.uk/candidate/jobadvert/MRI-2024-12345"
}
```

### Field Descriptions

<table>
<thead>
<tr>
<th>Field</th>
<th>Type</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>title</code></td>
<td>String</td>
<td>Job title/position name</td>
</tr>
<tr>
<td><code>company</code></td>
<td>String</td>
<td>NHS trust or organisation name</td>
</tr>
<tr>
<td><code>location</code></td>
<td>String</td>
<td>Job location with postcode</td>
</tr>
<tr>
<td><code>salary</code></td>
<td>String</td>
<td>Salary range or rate (may include NHS band)</td>
</tr>
<tr>
<td><code>contract_type</code></td>
<td>String</td>
<td>Employment contract type (Permanent, Fixed-Term, Locum, Bank, etc.)</td>
</tr>
<tr>
<td><code>working_pattern</code></td>
<td>String</td>
<td>Working hours pattern (Full time, Part time, Flexible, etc.)</td>
</tr>
<tr>
<td><code>date_posted</code></td>
<td>String</td>
<td>Date the job was posted</td>
</tr>
<tr>
<td><code>closing_date</code></td>
<td>String</td>
<td>Application deadline</td>
</tr>
<tr>
<td><code>reference</code></td>
<td>String</td>
<td>Job reference number</td>
</tr>
<tr>
<td><code>description_html</code></td>
<td>String</td>
<td>Full job description in HTML format (when collectDetails is true)</td>
</tr>
<tr>
<td><code>description_text</code></td>
<td>String</td>
<td>Plain text version of job description (when collectDetails is true)</td>
</tr>
<tr>
<td><code>url</code></td>
<td>String</td>
<td>Direct link to job posting</td>
</tr>
</tbody>
</table>

## How It Works

<ol>
<li><strong>Smart Search Construction:</strong> Builds optimized search URLs based on your input parameters</li>
<li><strong>Dual Extraction Strategy:</strong>
  <ul>
    <li>First attempts JSON API extraction for maximum speed</li>
    <li>Automatically falls back to HTML parsing if API unavailable</li>
    <li>Ensures data quality through multiple extraction methods</li>
  </ul>
</li>
<li><strong>Pagination Handling:</strong> Automatically processes multiple pages until reaching your desired result count</li>
<li><strong>Detail Collection:</strong> Optionally visits each job page to extract complete descriptions and metadata</li>
<li><strong>Data Enrichment:</strong> Attempts to extract structured data from JSON-LD when available</li>
<li><strong>Deduplication:</strong> Prevents duplicate job listings in results</li>
<li><strong>Clean Output:</strong> Provides consistently formatted, structured data ready for immediate use</li>
</ol>

## Performance & Limits

<ul>
<li><strong>Speed:</strong> Processes 50-100 jobs per minute (varies with detail collection settings)</li>
<li><strong>Concurrency:</strong> Optimized at 5 concurrent requests for reliable extraction</li>
<li><strong>Rate Limiting:</strong> Respects NHS Jobs server capacity with automatic retry logic</li>
<li><strong>Memory Efficient:</strong> Streams data to dataset, suitable for large-scale extractions</li>
</ul>

### Performance Tips

<dl>
<dt><strong>Faster Scraping</strong></dt>
<dd>Set <code>collectDetails: false</code> to skip individual job page visits (2-3x faster)</dd>

<dt><strong>Comprehensive Data</strong></dt>
<dd>Keep <code>collectDetails: true</code> for full descriptions and all metadata</dd>

<dt><strong>Large Datasets</strong></dt>
<dd>Use <code>max_pages</code> and <code>results_wanted</code> to control scope and costs</dd>
</dl>

## Common Questions

### Can I scrape all NHS jobs?

Yes, set `results_wanted` to a high number (e.g., 10000) and `max_pages` accordingly. Be aware this may take longer and consume more compute units.

### What if NHS Jobs changes their website?

The scraper uses multiple extraction methods (JSON API, JSON-LD, HTML parsing) to ensure continued functionality even if one method breaks.

### Can I filter by specific NHS pay bands?

Yes, use the `payRange` parameter with values like "Band 5", "Band 6", "Band 7", etc.

### How do I search for jobs near a specific location?

Set both `location` (city/postcode) and `distance` (radius in miles) parameters:

```json
{
  "location": "Leeds",
  "distance": "20"
}
```

### Can I export data to CSV or Excel?

Yes, Apify platform provides built-in export to CSV, Excel, JSON, XML, and more formats.

## Cost Optimization

<ul>
<li>Use specific search parameters to reduce unnecessary pages</li>
<li>Set <code>collectDetails: false</code> if you don't need full descriptions</li>
<li>Adjust <code>max_pages</code> to limit scope</li>
<li>Use <code>results_wanted</code> to stop when you have enough data</li>
</ul>

## Error Handling

The scraper includes robust error handling:

- Automatic retry on failed requests (up to 3 attempts)
- Session management for consistent scraping
- Graceful fallback between extraction methods
- Detailed logging for troubleshooting

## Integration & Export

### Apify Platform

Access your data directly from the Apify platform:
- Download in multiple formats (JSON, CSV, Excel, XML, RSS, HTML)
- Access via Apify API
- Set up scheduled runs
- Configure webhooks for automation

### API Access

Retrieve scraped data programmatically:

```bash
curl https://api.apify.com/v2/datasets/[DATASET_ID]/items
```

### Integration Examples

Works seamlessly with:
- Google Sheets (via Apify integration)
- Make (Integromat)
- Zapier
- Power BI, Tableau (via CSV/API)
- Custom applications (via REST API)

## Support & Updates

This scraper is actively maintained to ensure compatibility with NHS Jobs website. If you encounter any issues or have feature requests, please report them through the Apify platform.

## Legal & Compliance

<blockquote>
<p><strong>Important:</strong> Always ensure your use of this scraper complies with NHS Jobs' Terms of Service and applicable data protection regulations including GDPR. This tool is designed for legitimate business purposes such as job aggregation, market research, and career planning.</p>
</blockquote>

### Best Practices

- Respect rate limits and use reasonable concurrency settings
- Do not scrape personal data beyond publicly available job listings
- Use data responsibly and in accordance with UK data protection laws
- Consider contacting NHS Jobs for official data access if you need large-scale extraction

## Technical Requirements

- Runs on Apify platform (no local setup needed)
- Uses Apify Proxy (included with platform)
- Memory: 1024-2048 MB recommended
- Timeout: 60-300 seconds per request

## About This Scraper

Built with modern web scraping best practices:
- Reliable extraction with multiple fallback methods
- Clean, maintainable code architecture
- Comprehensive error handling
- Optimized for Apify platform
- Regular updates and maintenance

---

**Ready to extract NHS Jobs data?** Click the "Try for free" button to start scraping immediately!

*Last updated: December 2024*
