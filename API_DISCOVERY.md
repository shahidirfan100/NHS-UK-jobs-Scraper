# API Discovery — NHS UK Jobs

## Source

Site: https://www.jobs.nhs.uk

## Discovered Endpoints

### Search (XML API)

| Field       | Value                                            |
|-------------|--------------------------------------------------|
| endpoint    | https://www.jobs.nhs.uk/api/v1/search_xml        |
| method      | GET                                              |
| auth        | None required                                    |
| response    | XML                                              |

**Query Parameters**

| param    | type   | required | description                     |
|----------|--------|----------|---------------------------------|
| keyword  | string | no       | Job title or skill keyword      |
| location | string | no       | City, town, or postcode         |
| page     | int    | no       | Pagination page number (1-based)|

**Response Fields** (inside <vacancyDetails>)

| xml field   | description                  |
|-------------|------------------------------|
| reference   | Unique job reference ID      |
| title       | Job title                    |
| employer    | Employer / company name      |
| salary      | Salary range or fixed amount |
| type        | Contract type                |
| postDate    | Date posted                  |
| closeDate   | Application closing date     |
| url         | Direct link to job detail    |
| location    | Job location                 |

### Job Detail (HTML)

| Field    | Value                                                        |
|----------|--------------------------------------------------------------|
| endpoint | Each job URL from <url> field                              |
| method   | GET                                                          |
| auth     | None required                                                |
| response | HTML                                                         |

## Notes

- XML API returns 10 results per page. Paginate using ?page=N.
- No authentication or session token required for either endpoint.
- eta.jobs.nhs.uk URLs are normalized to www.jobs.nhs.uk automatically.
- API discovery keys, params, headers, and response fields should be matched case-insensitively.
