# Meta app review: permissions to request together

One Meta app and one review can cover WhatsApp, Instagram, Facebook leads, ads and organic post metrics. Submit them together so each one is reviewed once. Meta renames and regroups permissions from time to time, so check each name against the App Dashboard when you submit.

| Feature (task) | Permission / feature | Why we need it |
|---|---|---|
| WhatsApp send and receive (T035) | `whatsapp_business_messaging` | Send and receive messages |
| WhatsApp numbers and templates (T035) | `whatsapp_business_management` | Manage phone numbers and message templates |
| Lead Ads forms (T036) | `leads_retrieval` | Read lead form submissions |
| Lead Ads webhooks (T036) | `pages_manage_metadata` | Subscribe the Page to lead webhooks |
| Page selection (T036, T071) | `pages_show_list` | List the Pages the user manages |
| Ad spend and reach (T036) | `ads_read` | Daily insights per campaign and ad set |
| Offline conversions back to Meta (T036) | `ads_management` | Only if conversions are uploaded; skip otherwise |
| Instagram DMs (T036) | `instagram_manage_messages` | Read and answer Instagram DMs in the inbox |
| **Organic Instagram posts and insights (T071)** | `instagram_basic` | Read the account profile and its media |
| **Organic Instagram insights (T071)** | `instagram_manage_insights` | Post and account metrics: reach, saves, shares, views, followers |
| **Organic Facebook Page posts (T071)** | `pages_read_engagement` | Read Page posts, followers and engagement |
| **Organic Facebook Page insights (T071)** | `read_insights` | Page and post insights |
| Business assets (T036, T071) | `business_management` | Only if Pages and ad accounts sit inside the client's Business Manager |

## What the review needs from you

- A verified Meta business, a live privacy policy URL and a verified domain (B-3).
- A short screencast per permission showing where the data appears in the product. Record these once the matching screens exist (T035, T036, T071).
- Instagram accounts must be Business or Creator accounts linked to a Facebook Page. Personal accounts cannot return insights.
- Test users or a test business so the reviewer can see the flow without real customer data.

## Limits to tell clients

- Story metrics are available only while a story is live (24 hours), so the CRM captures them daily.
- Some post metrics are unavailable for very small accounts, for posts before the account became a business account, and for older posts. The CRM stores these as empty, never as zero.
- Metrics arrive with a delay of up to a day.
