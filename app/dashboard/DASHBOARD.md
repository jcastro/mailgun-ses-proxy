# Dashboard Implementation Walkthrough

## What Was Built

A full admin dashboard for the Mailgun → SES Proxy with authentication, stats, data tables, and settings management.

### Login Page

![Login page with dark theme, gradient background, centered card with email/password form](/Users/tilak/.gemini/antigravity/brain/58fa6bdb-67a6-4e81-8063-32a6535a33fb/.tempmediaStorage/media_58fa6bdb-67a6-4e81-8063-32a6535a33fb_1777100637513.png)

## Files Created/Modified

### Schema & Auth

| File                                                                                           | Description                                                                |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [schema.prisma](file:///Users/tilak/Documents/mailgun-ses-proxy/prisma/schema.prisma#L89-L103) | Added `DashboardUser` and `DashboardSettings` models                       |
| [auth.ts](file:///Users/tilak/Documents/mailgun-ses-proxy/lib/dashboard/auth.ts)               | Password hashing (PBKDF2), JWT sessions, cookie management                 |
| [proxy.ts](file:///Users/tilak/Documents/mailgun-ses-proxy/proxy.ts)                           | Updated middleware — dashboard uses cookie auth, API routes use Basic auth |

### API Routes

| Route                                 | File                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `POST /dashboard/api/login`           | [route.ts](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/api/login/route.ts)                |
| `POST /dashboard/api/logout`          | [route.ts](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/api/logout/route.ts)               |
| `GET /dashboard/api/stats`            | [route.ts](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/api/stats/route.ts)                |
| `GET /dashboard/api/newsletters`      | [route.ts](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/api/newsletters/route.ts)          |
| `GET /dashboard/api/newsletters/[id]` | [route.ts](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/api/newsletters/%5Bid%5D/route.ts) |
| `GET /dashboard/api/events`           | [route.ts](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/api/events/route.ts)               |
| `GET/PUT /dashboard/api/settings`     | [route.ts](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/api/settings/route.ts)             |

### UI Pages

| Page              | File                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Dashboard Layout  | [layout.tsx](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/layout.tsx)                                   |
| Login             | [login/page.tsx](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/login/page.tsx)                           |
| Stats Overview    | [page.tsx](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/page.tsx)                                       |
| Newsletters       | [newsletters/page.tsx](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/newsletters/page.tsx)               |
| Batch Detail      | [newsletters/[id]/page.tsx](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/newsletters/%5Bid%5D/page.tsx) |
| Events            | [events/page.tsx](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/events/page.tsx)                         |
| Settings          | [settings/page.tsx](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/settings/page.tsx)                     |
| CSS Design System | [dashboard.css](file:///Users/tilak/Documents/mailgun-ses-proxy/app/dashboard/dashboard.css)                             |
| Root Layout       | [layout.tsx](file:///Users/tilak/Documents/mailgun-ses-proxy/app/layout.tsx)                                             |

## Setup Steps

### 1. Run the migration

```bash
npx prisma migrate dev --name add_dashboard_tables
```

### 2. Set JWT secret (required)

Add to your `.env`:

```
DASHBOARD_JWT_SECRET=<generate-a-unique-random-secret-at-least-32-characters>
DASHBOARD_ADMIN_EMAIL=<your-admin-email>
DASHBOARD_ADMIN_PASSWORD=<unique-password-at-least-12-characters>
```

### 3. Provisioning and upgrades

On first login, an empty database is initialized only from the operator-configured credentials above. No public default credentials or remote credential-replacement flow exist. These variables initialize an account; they do not rotate existing users' passwords. Back up the database before an upgrade.

Existing configured accounts and PBKDF2 password hashes remain compatible. Keep the exact JWT secret bytes to preserve their sessions. The legacy `admin@localhost` identity is disabled. To recover an untouched legacy bootstrap account, explicitly set `DASHBOARD_RESET_LEGACY_ADMIN=true` together with a new admin email/password, restart and log in with the new credentials, then remove the reset flag. Only the legacy identity still using its original password is updated; customized accounts are never overwritten. If that identity has a customized password, rename/reset it through trusted database administration instead.

Production dashboard cookies require HTTPS, including when TLS is terminated at a reverse proxy. Login reserves attempt limits before database/hash work: eight per normalized email in 15 minutes and a global ceiling of 100 per minute, per process. Forwarding headers cannot reset these limits. Multiple replicas need an additional shared ingress rate limiter; in-memory limits reset on restart.

## Features

- **🔐 Authentication**: PBKDF2 password hashing + HMAC-SHA256 JWT sessions via HttpOnly cookies
- **📊 Stats Overview**: Total batches, accepted messages, delivery/open/click rates, bounces, complaints, unsubscribes, send errors, and activity breakdown
- **📬 Newsletters DataTable**: Paginated, sortable, searchable by id/site/from/subject/tag contents; click through to batch detail with message status, metrics, and errors
- **📡 Events DataTable**: Filter by event type, search by message/notification id, and inspect normalized Mailgun fields from SES events
- **⚙️ Settings**: Authenticated read-only deployment configuration; changes are made through environment variables
- **📱 Responsive**: Mobile-friendly with collapsible sidebar
- **🎨 Dark UI**: Indigo accent palette, glassmorphism header, smooth micro-animations
