# NHS UK Jobs Scraper

Extract comprehensive healthcare job listings from the official NHS Jobs platform with high speed and reliability. Collect detailed information about vacancies, including salary, location, contract types, and full job descriptions at scale.

## Features

- **Blazing Fast Extraction** — Optimized for high-speed data collection using efficient backend systems.
- **Comprehensive Job Details** — Collect job titles, employer names, precise locations, salary ranges, and application deadlines.
- **Rich Content Extraction** — Automatically extracts full job descriptions in both structured HTML and clean plain text formats.
- **Flexible Search Filters** — Support for keyword and location-based searches with customizable result counts.
- **Automatic Deduplication** — Built-in intelligence to prevent duplicate listings in your final dataset.
- **Clean Structured Output** — Consistently formatted data ready for immediate analysis or integration.

## Use Cases

### Healthcare Recruitment & Aggregation
Build niche job boards or healthcare-focused recruitment platforms by aggregating the latest opportunities from across the NHS.

### Market & Salary Analysis
Analyze compensation trends for specific roles (e.g., Nursing, Allied Health) across different geographic regions and NHS trusts.

### Workforce Monitoring
Monitor hiring trends and specialty demands within the National Health Service for strategic research or workforce planning.

### Personal Career Planning
Track specific job categories in your area and receive consolidated updates on new postings and closing dates.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `keyword` | String | No | `""` | Search by job title, skill, or reference number |
| `location` | String | No | `""` | City, town, or postcode to search in |
| `results_wanted` | Integer | No | `20` | Maximum number of job listings to collect |
| `max_pages` | Integer | No | `5` | Safety limit on the number of search pages to process |
| `collectDetails` | Boolean | No | `true` | Visit each job page to extract full descriptions |
| `startUrl` | String | No | `""` | Start from a specific NHS Jobs search URL (overrides filters) |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": true}` | Proxy settings (Residential recommended) |

---

## Output Data

Each item in the dataset contains structured information about a single job vacancy:

| Field | Type | Description |
|-------|------|-------------|
| `title` | String | Official job title |
| `company` | String | NHS Trust or hiring organisation name |
| `location` | String | Job location including city and postcode |
| `salary` | String | Salary range or pay band details |
| `contract_type` | String | Employment type (Permanent, Fixed-Term, Bank, etc.) |
| `working_pattern` | String | Working hours (Full-time, Part-time, Flexible) |
| `date_posted` | String | Formatted date when the job was listed |
| `closing_date` | String | Application deadline |
| `reference` | String | Unique NHS job reference number |
| `url` | String | Direct link to the job posting |
| `description_html` | String | Full job description in structured HTML (if enabled) |
| `description_text` | String | Clean plain text version of the job description |

---

## Usage Examples

### Basic Nurse Search in London

Extract the latest nursing opportunities in the London area:

```json
{
    "keyword": "nurse",
    "location": "London",
    "results_wanted": 50
}
```

### Rapid Listing Without Descriptions

Collect basic info for hundreds of jobs very quickly by skipping full descriptions:

```json
{
    "keyword": "administrator",
    "collectDetails": false,
    "results_wanted": 100
}
```

### Starting from a Filtered URL

Use a specific filtered search URL from the NHS Jobs website:

```json
{
    "startUrl": "https://www.jobs.nhs.uk/candidate/search/results?keyword=paramedic&location=Manchester",
    "results_wanted": 20
}
```

---

## Sample Output

```json
{
  "title": "Registered Nurse - Emergency Department",
  "company": "NHS Foundation Trust",
  "location": "Manchester Royal Infirmary, Manchester, M13 9WL",
  "salary": "£28,407 to £34,581 a year",
  "contract_type": "Permanent",
  "working_pattern": "Full-time",
  "date_posted": "07 May 2026",
  "closing_date": "04 June 2026",
  "reference": "123-ABC-456",
  "url": "https://www.jobs.nhs.uk/candidate/jobadvert/123-ABC-456",
  "description_text": "Job summary\n\nWe are looking for motivated Registered Nurses..."
}
```

---

## Tips for Best Results

### Optimize for Speed
If you only need basic listing info (title, salary, location), set `collectDetails` to `false`. This makes the scraper significantly faster as it avoids visiting every individual job page.

### Accurate Locations
Use full postcodes for the most precise location-based results.

### Proxy Usage
Always use **Residential Proxies** when running large-scale extractions to ensure consistent access and avoid regional blocks.

---

## Integrations

Connect your NHS job data with your favorite tools:

- **Google Sheets** — Export directly for analysis and tracking.
- **Airtable** — Build searchable job databases and recruitment CRM.
- **Zapier** — Trigger automated emails or notifications for new jobs.
- **Webhooks** — Send data to your custom backend API in real-time.

### Export Formats

- **JSON** — For developers and system integrations.
- **CSV** — For spreadsheet software and data analysis.
- **Excel** — For business reporting and documentation.
- **XML** — For legacy system compatibility.

---

## Frequently Asked Questions

### How fast is the scraper?
The scraper is highly optimized and can collect dozens of jobs per minute. Speed depends primarily on whether you enable full description extraction.

### Can I scrape jobs from specific NHS Trusts?
Yes, you can include the Trust name in the `keyword` parameter or use a `startUrl` from a trust-filtered search.

### Is the data formatted consistently?
Yes, the scraper includes built-in normalization for dates, currencies, and addresses to ensure your dataset is clean and ready for use.

### Does it handle application deadlines?
Yes, application closing dates are extracted and formatted for every listing where available.

---

## Support

For issues or feature requests, please contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with website terms of service and applicable data protection laws. Use data responsibly and respect the source platform.
