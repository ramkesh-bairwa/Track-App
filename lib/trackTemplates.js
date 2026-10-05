// Ready-made track templates offered in the "New track" modal. Picking one
// pre-fills the name, icon, color and column structure; everything stays
// editable afterwards like any other track.
//
// Columns are written as compact "Label:type" strings to keep this list
// readable — `type` is a field type id from lib/fieldTypes.js, and dropdown
// style types take their options after an "=", e.g. "Status:select=Open,Done".

const GROUPS = [
  {
    id: 'security',
    label: 'Security & Access',
    color: '#E5646B',
    templates: [
      ['credentials', 'Credentials', 'key', 'Logins for any site or service', ['Service:text', 'Username:text', 'Email:email', 'Password:password', 'URL:link', 'Notes:textarea']],
      ['passwords', 'Password Vault', 'lock', 'Personal password manager', ['Title:text', 'Username:text', 'Password:password', 'Website:link', 'Category:select=Personal,Work,Finance,Social,Other', 'Last changed:date']],
      ['api-keys', 'API Keys', 'code', 'Keys and tokens for third-party APIs', ['Provider:text', 'Key name:text', 'API key:password', 'Secret:password', 'Environment:select=Development,Staging,Production', 'Expires:date', 'Notes:textarea']],
      ['ssh-keys', 'SSH Keys', 'terminal', 'SSH key pairs and where they are used', ['Name:text', 'Host:text', 'User:text', 'Public key:textarea', 'Private key:password', 'Passphrase:password', 'Created:date']],
      ['two-factor', '2FA Backup Codes', 'shield-halved', 'Recovery codes for two-factor auth', ['Account:text', 'Method:select=Authenticator app,SMS,Hardware key,Email', 'Backup codes:password', 'Recovery email:email', 'Set up on:date']],
      ['security-audit', 'Security Audit', 'user-shield', 'Findings from security reviews', ['Finding:text', 'Asset:text', 'Severity:select=Critical,High,Medium,Low,Info', 'Status:select=Open,In progress,Fixed,Accepted', 'Found on:date', 'Details:textarea']],
      ['vulnerabilities', 'Vulnerabilities (CVE)', 'bug', 'Track CVEs affecting your systems', ['CVE ID:text', 'Package:text', 'CVSS score:decimal', 'Severity:select=Critical,High,Medium,Low', 'Patched:checkbox', 'Reference:link', 'Notes:textarea']],
      ['certificates', 'SSL Certificates', 'certificate', 'Certificates and their expiry dates', ['Domain:text', 'Issuer:text', 'Type:select=DV,OV,EV,Wildcard,Self-signed', 'Issued:date', 'Expires:date', 'Auto renew:checkbox', 'Notes:textarea']],
      ['access-control', 'Access Control', 'id-badge', 'Who has access to what', ['Person:text', 'System:text', 'Role:select=Admin,Editor,Viewer,Owner', 'Granted on:date', 'Revoked:checkbox', 'Approved by:text']],
      ['vpn', 'VPN Accounts', 'network-wired', 'VPN servers and profiles', ['Provider:text', 'Server:text', 'Username:text', 'Password:password', 'Protocol:select=WireGuard,OpenVPN,IPSec,L2TP', 'Config file:file']],
      ['wifi', 'Wi-Fi Networks', 'wifi', 'Network names and passwords', ['Network (SSID):text', 'Password:password', 'Security:select=WPA3,WPA2,WEP,Open', 'Location:text', 'Router admin URL:link']],
      ['recovery-keys', 'Recovery Keys', 'fingerprint', 'Disk encryption and account recovery keys', ['Device / account:text', 'Key type:select=BitLocker,FileVault,Account recovery,Seed phrase,Other', 'Recovery key:password', 'Stored on:date', 'Notes:textarea']],
      ['incidents', 'Security Incidents', 'triangle-exclamation', 'Incident log and response', ['Incident:text', 'Detected:datetime', 'Severity:select=Sev 1,Sev 2,Sev 3,Sev 4', 'Status:select=Investigating,Contained,Resolved', 'Owner:text', 'Summary:textarea']],
    ],
  },
  {
    id: 'payments',
    label: 'Payments & Finance',
    color: '#E8A33D',
    templates: [
      ['payment-gateways', 'Payment Gateways', 'credit-card', 'Stripe, Razorpay, PayPal and other gateway keys', ['Gateway:select=Stripe,Razorpay,PayPal,Square,Braintree,Paytm,PhonePe,Cashfree,Other', 'Mode:select=Test,Live', 'Merchant ID:text', 'Publishable key:text', 'Secret key:password', 'Webhook secret:password', 'Dashboard:link', 'Notes:textarea']],
      ['bank-accounts', 'Bank Accounts', 'building-columns', 'Account numbers and branch details', ['Bank:text', 'Account holder:text', 'Account number:password', 'IFSC / SWIFT:text', 'Account type:select=Savings,Current,Salary,Fixed deposit', 'Branch:text', 'Net banking URL:link']],
      ['cards', 'Credit & Debit Cards', 'wallet', 'Card details and billing dates', ['Card name:text', 'Type:select=Credit,Debit,Prepaid', 'Network:select=Visa,Mastercard,RuPay,Amex,Discover', 'Last 4 digits:char', 'Expiry:month', 'Credit limit:decimal', 'Due day:number']],
      ['upi', 'UPI IDs', 'mobile-screen', 'UPI handles and linked accounts', ['UPI ID:text', 'App:select=Google Pay,PhonePe,Paytm,BHIM,Other', 'Linked bank:text', 'PIN hint:password', 'Primary:checkbox']],
      ['expenses', 'Expenses', 'receipt', 'Day-to-day spending', ['Date:date', 'Description:text', 'Category:select=Food,Transport,Shopping,Bills,Health,Entertainment,Other', 'Amount:decimal', 'Paid with:select=Cash,Card,UPI,Bank transfer', 'Receipt:file']],
      ['income', 'Income', 'money-bill-trend-up', 'Salary, freelance and other income', ['Date:date', 'Source:text', 'Type:select=Salary,Freelance,Business,Interest,Dividend,Other', 'Amount:decimal', 'Received:checkbox', 'Notes:textarea']],
      ['budget', 'Budget', 'chart-pie', 'Monthly budget by category', ['Month:month', 'Category:text', 'Budgeted:decimal', 'Spent:decimal', 'Notes:textarea']],
      ['invoices', 'Invoices', 'file-invoice-dollar', 'Invoices sent to clients', ['Invoice #:number:auto', 'Client:text', 'Issued:date', 'Due:date', 'Amount:decimal', 'Status:select=Draft,Sent,Paid,Overdue', 'PDF:file']],
      ['bills', 'Bills & Utilities', 'file-invoice', 'Recurring bills and due dates', ['Bill:text', 'Provider:text', 'Amount:decimal', 'Due date:date', 'Frequency:select=Monthly,Quarterly,Yearly', 'Paid:checkbox', 'Auto-pay:checkbox']],
      ['subscriptions', 'Subscriptions', 'repeat', 'Streaming, software and other subscriptions', ['Service:text', 'Plan:text', 'Price:decimal', 'Billing:select=Monthly,Yearly,Weekly', 'Renews on:date', 'Account email:email', 'Cancel URL:link']],
      ['investments', 'Investments', 'chart-line', 'Stocks, mutual funds and other holdings', ['Name:text', 'Type:select=Stock,Mutual fund,ETF,Bond,FD,Gold,Real estate,Other', 'Units:decimal', 'Buy price:decimal', 'Current value:decimal', 'Bought on:date', 'Platform:text']],
      ['crypto', 'Crypto Wallets', 'bitcoin-sign', 'Wallets, exchanges and seed phrases', ['Wallet / exchange:text', 'Coin:text', 'Address:text', 'Seed phrase:password', 'Holdings:decimal', 'Network:text', 'Notes:textarea']],
      ['loans', 'Loans & EMIs', 'hand-holding-dollar', 'Loans, EMIs and outstanding balances', ['Lender:text', 'Type:select=Home,Car,Personal,Education,Business,Other', 'Principal:decimal', 'Interest rate %:decimal', 'EMI:decimal', 'Start date:date', 'End date:date']],
      ['taxes', 'Taxes', 'scale-balanced', 'Tax filings and payments', ['Financial year:text', 'Type:select=Income tax,GST,Property tax,Advance tax,Other', 'Amount:decimal', 'Filed on:date', 'Acknowledgement #:text', 'Document:file']],
      ['insurance', 'Insurance Policies', 'umbrella', 'Health, life, vehicle and home policies', ['Policy:text', 'Insurer:text', 'Type:select=Health,Life,Vehicle,Home,Travel,Other', 'Policy number:text', 'Premium:decimal', 'Renewal date:date', 'Document:file']],
      ['savings-goals', 'Savings Goals', 'piggy-bank', 'Goals and progress towards them', ['Goal:text', 'Target:decimal', 'Saved so far:decimal', 'Deadline:date', 'Priority:select=High,Medium,Low']],
      ['debts', 'Money Lent / Borrowed', 'handshake', 'Who owes whom', ['Person:text', 'Direction:select=I lent,I borrowed', 'Amount:decimal', 'Date:date', 'Settled:checkbox', 'Notes:textarea']],
    ],
  },
  {
    id: 'dev',
    label: 'Development & DevOps',
    color: '#6C7BFF',
    templates: [
      ['env-vars', 'Environment Variables', 'sliders', '.env values per project and environment', ['Project:text', 'Key:text', 'Value:password', 'Environment:select=Local,Development,Staging,Production', 'Notes:textarea']],
      ['servers', 'Servers', 'server', 'Server hosts and access details', ['Name:text', 'IP / host:text', 'Provider:text', 'OS:text', 'SSH user:text', 'Password:password', 'Role:select=Web,Database,Worker,Cache,Other', 'Notes:textarea']],
      ['databases', 'Databases', 'database', 'Connection details for databases', ['Name:text', 'Engine:select=MySQL,PostgreSQL,MongoDB,Redis,SQLite,SQL Server,Other', 'Host:text', 'Port:number', 'Database:text', 'Username:text', 'Password:password', 'Environment:select=Development,Staging,Production']],
      ['repositories', 'Git Repositories', 'code-branch', 'Repos and their purpose', ['Name:text', 'URL:link', 'Platform:select=GitHub,GitLab,Bitbucket,Azure DevOps,Other', 'Default branch:text', 'Language:text', 'Description:textarea']],
      ['bugs', 'Bug Tracker', 'bug', 'Bugs with priority and status', ['Title:text', 'Priority:select=P0,P1,P2,P3', 'Status:select=Open,In progress,In review,Fixed,Won\'t fix', 'Reported:date', 'Assignee:text', 'Steps to reproduce:textarea']],
      ['features', 'Feature Requests', 'lightbulb', 'Ideas and requested features', ['Feature:text', 'Requested by:text', 'Votes:number', 'Status:select=Idea,Planned,In progress,Shipped,Rejected', 'Details:textarea']],
      ['deployments', 'Deployments', 'rocket', 'Release and deployment log', ['Version:text', 'Environment:select=Staging,Production', 'Deployed at:datetime', 'Deployed by:text', 'Status:select=Success,Failed,Rolled back', 'Changelog:textarea']],
      ['releases', 'Release Notes', 'tag', 'Versioned release notes', ['Version:text', 'Release date:date', 'Type:select=Major,Minor,Patch', 'Highlights:textarea', 'Link:link']],
      ['snippets', 'Code Snippets', 'file-code', 'Reusable bits of code', ['Title:text', 'Language:select=JavaScript,TypeScript,Python,SQL,Bash,PHP,Java,Go,Other', 'Code:longtext', 'Tags:text', 'Source:link']],
      ['commands', 'Terminal Commands', 'terminal', 'Handy shell commands', ['Command:text', 'What it does:textarea', 'Shell:select=bash,zsh,PowerShell,cmd,fish', 'Category:text']],
      ['endpoints', 'API Endpoints', 'plug', 'Documentation for API routes', ['Method:select=GET,POST,PUT,PATCH,DELETE', 'Path:text', 'Description:textarea', 'Auth required:checkbox', 'Request example:json', 'Response example:json']],
      ['webhooks', 'Webhooks', 'arrow-right-arrow-left', 'Webhook URLs and signing secrets', ['Name:text', 'Provider:text', 'URL:link', 'Events:text', 'Signing secret:password', 'Active:checkbox']],
      ['cron-jobs', 'Cron Jobs', 'clock', 'Scheduled jobs and their schedules', ['Job:text', 'Schedule (cron):text', 'Server:text', 'Command:text', 'Enabled:checkbox', 'Last run:datetime']],
      ['packages', 'Dependencies', 'cubes', 'Libraries and versions used', ['Package:text', 'Version:text', 'Ecosystem:select=npm,pip,composer,maven,gem,cargo,go,Other', 'License:text', 'Used in:text', 'Docs:link']],
      ['tech-debt', 'Tech Debt', 'screwdriver-wrench', 'Known shortcuts to clean up', ['Item:text', 'Area:text', 'Impact:select=High,Medium,Low', 'Effort:select=S,M,L,XL', 'Status:select=Open,Scheduled,Done', 'Notes:textarea']],
      ['test-cases', 'Test Cases', 'vial', 'Manual QA test cases', ['ID:number:auto', 'Scenario:text', 'Steps:textarea', 'Expected result:textarea', 'Status:select=Not run,Pass,Fail,Blocked']],
      ['error-logs', 'Error Log', 'circle-exclamation', 'Errors seen and how they were fixed', ['Error:text', 'Seen at:datetime', 'Service:text', 'Stack trace:longtext', 'Fixed:checkbox', 'Fix:textarea']],
      ['sdk-keys', 'Mobile App Keys', 'mobile', 'Firebase, push and store credentials', ['App:text', 'Platform:select=Android,iOS,Web', 'Service:select=Firebase,OneSignal,App Store Connect,Play Console,Other', 'Key / ID:text', 'Secret:password', 'Config file:file']],
    ],
  },
  {
    id: 'cloud',
    label: 'Cloud, Hosting & Web',
    color: '#4FA6E8',
    templates: [
      ['cloud-accounts', 'Cloud Accounts', 'cloud', 'AWS, GCP, Azure and other cloud logins', ['Provider:select=AWS,Google Cloud,Azure,DigitalOcean,Linode,Vercel,Netlify,Other', 'Account ID:text', 'Root email:email', 'Password:password', 'Access key:text', 'Secret key:password', 'Console:link']],
      ['domains', 'Domains', 'globe', 'Domains, registrars and renewals', ['Domain:text', 'Registrar:text', 'Registered:date', 'Expires:date', 'Auto renew:checkbox', 'DNS provider:text', 'Login URL:link']],
      ['dns-records', 'DNS Records', 'sitemap', 'DNS entries for your domains', ['Domain:text', 'Type:select=A,AAAA,CNAME,MX,TXT,NS,SRV', 'Name:text', 'Value:text', 'TTL:number', 'Proxied:checkbox']],
      ['hosting', 'Hosting Accounts', 'hard-drive', 'Shared, VPS and managed hosting', ['Provider:text', 'Plan:text', 'Control panel URL:link', 'Username:text', 'Password:password', 'Renewal:date', 'Price:decimal']],
      ['email-accounts', 'Email Accounts', 'envelope', 'Mailboxes and SMTP/IMAP settings', ['Email:email', 'Password:password', 'Provider:text', 'SMTP host:text', 'SMTP port:number', 'IMAP host:text', 'Webmail:link']],
      ['websites', 'Websites', 'window-maximize', 'Sites you own or manage', ['Site:text', 'URL:link', 'CMS / stack:text', 'Admin URL:link', 'Admin user:text', 'Admin password:password', 'Hosted on:text']],
      ['storage-buckets', 'Storage Buckets', 'box-archive', 'S3 / GCS buckets and access', ['Bucket:text', 'Provider:select=AWS S3,Google Cloud Storage,Azure Blob,Cloudflare R2,Other', 'Region:text', 'Public:checkbox', 'Access key:text', 'Secret:password']],
      ['monitoring', 'Uptime Monitoring', 'heart-pulse', 'Monitors, checks and alert contacts', ['Service:text', 'URL:link', 'Check interval (min):number', 'Alert email:email', 'Status:select=Up,Down,Paused', 'Tool:text']],
      ['seo', 'SEO Keywords', 'magnifying-glass-chart', 'Keywords, ranks and target pages', ['Keyword:text', 'Target page:link', 'Search volume:number', 'Current rank:number', 'Difficulty:range', 'Checked on:date']],
      ['analytics', 'Analytics Properties', 'chart-simple', 'Google Analytics, Mixpanel and more', ['Property:text', 'Tool:select=Google Analytics,Mixpanel,Amplitude,Plausible,Hotjar,Other', 'Tracking ID:text', 'Site:link', 'Owner email:email']],
      ['saas-tools', 'SaaS Tools', 'layer-group', 'Tools your team uses and who owns them', ['Tool:text', 'Purpose:text', 'Plan:text', 'Monthly cost:decimal', 'Owner:text', 'Login URL:link', 'Seats:number']],
    ],
  },
  {
    id: 'business',
    label: 'Business & Work',
    color: '#35C2A6',
    templates: [
      ['clients', 'Clients', 'user-tie', 'Client list with contact details', ['Client:text', 'Company:text', 'Email:email', 'Phone:tel', 'Status:select=Lead,Active,Past', 'Since:date', 'Notes:textarea']],
      ['contacts', 'Contacts', 'address-book', 'People and how to reach them', ['Name:text', 'Phone:tel', 'Email:email', 'Company:text', 'Birthday:date', 'Address:textarea', 'Notes:textarea']],
      ['leads', 'Sales Leads', 'bullseye', 'Pipeline of potential customers', ['Lead:text', 'Company:text', 'Email:email', 'Stage:select=New,Contacted,Qualified,Proposal,Won,Lost', 'Deal value:decimal', 'Next follow-up:date', 'Notes:textarea']],
      ['projects', 'Projects', 'diagram-project', 'Projects with status and deadlines', ['Project:text', 'Client:text', 'Status:select=Planning,Active,On hold,Completed,Cancelled', 'Start:date', 'Deadline:date', 'Budget:decimal', 'Description:textarea']],
      ['tasks', 'Tasks / To-do', 'list-check', 'Tasks with priority and due dates', ['Task:text', 'Priority:select=High,Medium,Low', 'Due:date', 'Done:checkbox', 'Assignee:text', 'Notes:textarea']],
      ['meetings', 'Meeting Notes', 'people-group', 'Meetings, attendees and action items', ['Title:text', 'Date:datetime', 'Attendees:text', 'Agenda:textarea', 'Notes:longtext', 'Action items:textarea']],
      ['employees', 'Employees', 'users', 'Team members and roles', ['Name:text', 'Role:text', 'Department:text', 'Email:email', 'Phone:tel', 'Joined:date', 'Status:select=Active,On leave,Left']],
      ['vendors', 'Vendors & Suppliers', 'truck-field', 'Suppliers and what they provide', ['Vendor:text', 'Contact person:text', 'Email:email', 'Phone:tel', 'Provides:text', 'Payment terms:text', 'Rating:range']],
      ['inventory', 'Inventory', 'boxes-stacked', 'Stock levels and reorder points', ['SKU:text', 'Item:text', 'Quantity:number', 'Reorder level:number', 'Unit price:decimal', 'Location:text', 'Supplier:text']],
      ['products', 'Products', 'box', 'Product catalog', ['Product:text', 'SKU:text', 'Category:text', 'Price:decimal', 'In stock:checkbox', 'Image:file', 'Description:textarea']],
      ['orders', 'Orders', 'cart-flatbed', 'Customer orders and fulfilment', ['Order #:number:auto', 'Customer:text', 'Date:date', 'Total:decimal', 'Status:select=Pending,Paid,Shipped,Delivered,Cancelled,Refunded', 'Tracking:link']],
      ['contracts', 'Contracts', 'file-contract', 'Agreements with start and end dates', ['Contract:text', 'Party:text', 'Type:select=Service,NDA,Employment,Lease,Vendor,Other', 'Start:date', 'End:date', 'Value:decimal', 'Document:file']],
      ['okrs', 'OKRs & Goals', 'flag-checkered', 'Objectives and key results', ['Objective:text', 'Key result:text', 'Quarter:select=Q1,Q2,Q3,Q4', 'Progress %:range', 'Owner:text', 'Status:select=On track,At risk,Off track,Done']],
      ['timesheet', 'Timesheet', 'business-time', 'Hours worked per project', ['Date:date', 'Project:text', 'Task:text', 'Hours:decimal', 'Billable:checkbox', 'Notes:textarea']],
      ['job-applications', 'Job Applications', 'briefcase', 'Jobs applied for and interview stages', ['Company:text', 'Role:text', 'Applied:date', 'Stage:select=Applied,Screening,Interview,Offer,Rejected,Withdrawn', 'Salary:decimal', 'Job link:link', 'Notes:textarea']],
      ['interviews', 'Candidate Interviews', 'user-check', 'Candidates and interview feedback', ['Candidate:text', 'Role:text', 'Interview date:datetime', 'Interviewer:text', 'Rating:range', 'Decision:select=Hire,No hire,Next round,Pending', 'Feedback:textarea']],
      ['support-tickets', 'Support Tickets', 'headset', 'Customer issues and resolutions', ['Ticket #:number:auto', 'Customer:text', 'Subject:text', 'Priority:select=Urgent,High,Normal,Low', 'Status:select=Open,Pending,Solved,Closed', 'Opened:datetime', 'Details:textarea']],
      ['assets', 'Company Assets', 'laptop', 'Laptops, phones and equipment', ['Asset:text', 'Serial number:text', 'Assigned to:text', 'Purchased:date', 'Cost:decimal', 'Warranty until:date', 'Condition:select=New,Good,Needs repair,Retired']],
      ['licenses', 'Software Licenses', 'id-card', 'License keys and seats', ['Software:text', 'License key:password', 'Seats:number', 'Purchased:date', 'Expires:date', 'Registered email:email']],
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing & Social',
    color: '#B47FE8',
    templates: [
      ['social-accounts', 'Social Media Accounts', 'hashtag', 'Handles and logins for social platforms', ['Platform:select=Instagram,Facebook,X / Twitter,LinkedIn,YouTube,TikTok,Pinterest,Threads,Other', 'Handle:text', 'Email:email', 'Password:password', 'Profile URL:link', 'Followers:number']],
      ['content-calendar', 'Content Calendar', 'calendar-days', 'Planned posts and publishing dates', ['Title:text', 'Channel:select=Blog,Instagram,LinkedIn,YouTube,Newsletter,X / Twitter,Other', 'Publish date:date', 'Status:select=Idea,Drafting,Scheduled,Published', 'Owner:text', 'Link:link']],
      ['campaigns', 'Ad Campaigns', 'bullhorn', 'Paid campaigns and performance', ['Campaign:text', 'Platform:select=Google Ads,Meta Ads,LinkedIn Ads,X Ads,Other', 'Budget:decimal', 'Start:date', 'End:date', 'Clicks:number', 'Conversions:number']],
      ['newsletter', 'Newsletter Issues', 'newspaper', 'Newsletter editions and stats', ['Issue #:number:auto', 'Subject:text', 'Sent on:date', 'Recipients:number', 'Open rate %:decimal', 'Click rate %:decimal']],
      ['influencers', 'Influencers', 'star', 'Creators and collaboration details', ['Name:text', 'Platform:text', 'Handle:text', 'Followers:number', 'Rate:decimal', 'Email:email', 'Status:select=To contact,In talks,Signed,Done']],
      ['blog-ideas', 'Blog Post Ideas', 'pen-nib', 'Ideas and drafts for articles', ['Title:text', 'Keyword:text', 'Status:select=Idea,Outline,Draft,Published', 'Draft:longtext', 'Published URL:link']],
      ['brand-assets', 'Brand Assets', 'palette', 'Logos, colors and fonts', ['Asset:text', 'Type:select=Logo,Color,Font,Image,Template,Other', 'Color:color', 'File:file', 'Usage notes:textarea']],
    ],
  },
  {
    id: 'personal',
    label: 'Personal & Documents',
    color: '#35C2A6',
    templates: [
      ['id-documents', 'ID Documents', 'passport', 'Passport, licence, national ID', ['Document:select=Passport,Driving licence,National ID,PAN,Aadhaar,Voter ID,Other', 'Number:password', 'Name on document:text', 'Issued:date', 'Expires:date', 'Scan:file']],
      ['important-dates', 'Important Dates', 'calendar-check', 'Birthdays, anniversaries, deadlines', ['Occasion:text', 'Person:text', 'Date:date', 'Type:select=Birthday,Anniversary,Deadline,Holiday,Other', 'Remind me:checkbox']],
      ['journal', 'Journal', 'book-open', 'Daily journal entries', ['Date:date', 'Title:text', 'Mood:select=Great,Good,Okay,Bad,Awful', 'Entry:longtext']],
      ['goals', 'Personal Goals', 'mountain', 'Goals and milestones', ['Goal:text', 'Area:select=Health,Career,Finance,Learning,Relationships,Other', 'Target date:date', 'Progress %:range', 'Achieved:checkbox', 'Notes:textarea']],
      ['habits', 'Habit Tracker', 'calendar-week', 'Daily habits and streaks', ['Date:date', 'Habit:text', 'Done:checkbox', 'Notes:text']],
      ['bookmarks', 'Bookmarks', 'bookmark', 'Links worth keeping', ['Title:text', 'URL:link', 'Category:text', 'Tags:text', 'Notes:textarea']],
      ['ideas', 'Ideas', 'lightbulb', 'Ideas to revisit later', ['Idea:text', 'Category:text', 'Excitement:range', 'Details:textarea', 'Added:date']],
      ['wishlist', 'Wishlist', 'gift', 'Things you want to buy', ['Item:text', 'Price:decimal', 'Link:link', 'Priority:select=Must have,Nice to have,Someday', 'Bought:checkbox']],
      ['gifts', 'Gift Ideas', 'gifts', 'Gifts given and planned', ['Person:text', 'Occasion:text', 'Gift:text', 'Budget:decimal', 'Given:checkbox', 'Date:date']],
      ['family', 'Family Members', 'people-roof', 'Family details in one place', ['Name:text', 'Relation:text', 'Birthday:date', 'Phone:tel', 'Blood group:select=A+,A-,B+,B-,AB+,AB-,O+,O-', 'Notes:textarea']],
      ['emergency', 'Emergency Contacts', 'phone-volume', 'Who to call in an emergency', ['Name:text', 'Relation:text', 'Phone:tel', 'Alternate phone:tel', 'Address:textarea']],
      ['warranties', 'Warranties & Receipts', 'receipt', 'Purchases and warranty periods', ['Product:text', 'Store:text', 'Purchased:date', 'Price:decimal', 'Warranty until:date', 'Receipt:file']],
      ['memberships', 'Memberships & Loyalty', 'id-card-clip', 'Loyalty cards and memberships', ['Program:text', 'Member ID:text', 'Points:number', 'Tier:text', 'Expires:date', 'Login URL:link']],
      ['quotes', 'Quotes', 'quote-left', 'Quotes you like', ['Quote:textarea', 'Author:text', 'Source:text', 'Tags:text']],
    ],
  },
  {
    id: 'health',
    label: 'Health & Fitness',
    color: '#E5646B',
    templates: [
      ['medical-records', 'Medical Records', 'file-medical', 'Diagnoses, visits and reports', ['Date:date', 'Doctor:text', 'Hospital / clinic:text', 'Reason:text', 'Diagnosis:textarea', 'Report:file']],
      ['medications', 'Medications', 'pills', 'Medicines, dosage and schedule', ['Medicine:text', 'Dosage:text', 'Frequency:select=Once a day,Twice a day,Thrice a day,As needed,Weekly', 'Start:date', 'End:date', 'Prescribed by:text']],
      ['workouts', 'Workouts', 'dumbbell', 'Exercise log', ['Date:date', 'Exercise:text', 'Type:select=Strength,Cardio,Yoga,Sports,Other', 'Sets:number', 'Reps:number', 'Weight (kg):decimal', 'Duration (min):number']],
      ['weight', 'Weight & Body', 'weight-scale', 'Weight and body measurements', ['Date:date', 'Weight (kg):decimal', 'Body fat %:decimal', 'Waist (cm):decimal', 'Notes:text']],
      ['meals', 'Meal & Diet Log', 'utensils', 'Meals and calories', ['Date:date', 'Meal:select=Breakfast,Lunch,Dinner,Snack', 'Food:text', 'Calories:number', 'Protein (g):decimal', 'Notes:text']],
      ['sleep', 'Sleep Log', 'bed', 'Sleep duration and quality', ['Date:date', 'Bedtime:time', 'Wake time:time', 'Hours:decimal', 'Quality:select=Great,Good,Fair,Poor']],
      ['doctors', 'Doctors & Clinics', 'user-doctor', 'Your healthcare providers', ['Name:text', 'Speciality:text', 'Clinic:text', 'Phone:tel', 'Address:textarea', 'Next visit:date']],
      ['vaccinations', 'Vaccinations', 'syringe', 'Vaccines and due doses', ['Person:text', 'Vaccine:text', 'Dose:text', 'Date given:date', 'Next due:date', 'Certificate:file']],
      ['period', 'Cycle Tracker', 'droplet', 'Menstrual cycle log', ['Start date:date', 'End date:date', 'Flow:select=Light,Medium,Heavy', 'Symptoms:text', 'Notes:textarea']],
    ],
  },
  {
    id: 'learning',
    label: 'Learning & Education',
    color: '#6C7BFF',
    templates: [
      ['courses', 'Courses', 'graduation-cap', 'Online and offline courses', ['Course:text', 'Platform:text', 'Instructor:text', 'Progress %:range', 'Status:select=Planned,In progress,Completed,Dropped', 'Certificate:file', 'Link:link']],
      ['books', 'Reading List', 'book', 'Books read and to read', ['Title:text', 'Author:text', 'Genre:text', 'Status:select=To read,Reading,Finished,Abandoned', 'Rating:range', 'Finished on:date', 'Notes:textarea']],
      ['study-notes', 'Study Notes', 'note-sticky', 'Notes by subject and topic', ['Subject:text', 'Topic:text', 'Notes:longtext', 'Revised:checkbox', 'Date:date']],
      ['exams', 'Exams & Grades', 'square-poll-vertical', 'Exam dates and scores', ['Subject:text', 'Exam:text', 'Date:date', 'Max marks:number', 'Score:decimal', 'Grade:text']],
      ['assignments', 'Assignments', 'clipboard-list', 'Homework and assignment deadlines', ['Assignment:text', 'Subject:text', 'Due:date', 'Status:select=Not started,In progress,Submitted,Graded', 'Grade:text', 'File:file']],
      ['vocabulary', 'Vocabulary', 'language', 'Words and phrases in a new language', ['Word:text', 'Meaning:text', 'Language:text', 'Example:textarea', 'Learned:checkbox']],
      ['certifications', 'Certifications', 'award', 'Professional certifications', ['Certification:text', 'Issuer:text', 'Credential ID:text', 'Earned:date', 'Expires:date', 'Verify URL:link', 'Certificate:file']],
      ['research', 'Research Papers', 'flask', 'Papers and references', ['Title:text', 'Authors:text', 'Year:year', 'Journal:text', 'DOI / URL:link', 'Summary:textarea']],
      ['flashcards', 'Flashcards', 'layer-group', 'Question and answer cards', ['Question:textarea', 'Answer:textarea', 'Deck:text', 'Known:checkbox']],
    ],
  },
  {
    id: 'home',
    label: 'Home & Life',
    color: '#E8A33D',
    templates: [
      ['home-maintenance', 'Home Maintenance', 'house-chimney', 'Repairs, services and schedules', ['Task:text', 'Area:select=Kitchen,Bathroom,Electrical,Plumbing,Garden,Appliance,Other', 'Last done:date', 'Next due:date', 'Cost:decimal', 'Service person:text']],
      ['appliances', 'Appliances', 'plug-circle-bolt', 'Appliances, models and warranties', ['Appliance:text', 'Brand:text', 'Model:text', 'Serial number:text', 'Purchased:date', 'Warranty until:date', 'Manual:file']],
      ['groceries', 'Grocery List', 'basket-shopping', 'Things to buy', ['Item:text', 'Quantity:text', 'Category:select=Vegetables,Fruits,Dairy,Grains,Snacks,Household,Other', 'Bought:checkbox']],
      ['recipes', 'Recipes', 'bowl-food', 'Recipes you cook', ['Recipe:text', 'Cuisine:text', 'Prep time (min):number', 'Servings:number', 'Ingredients:textarea', 'Steps:longtext', 'Photo:file']],
      ['plants', 'Plants', 'seedling', 'Plant care schedule', ['Plant:text', 'Location:text', 'Watering:select=Daily,Every 2 days,Weekly,Fortnightly', 'Last watered:date', 'Sunlight:select=Full sun,Partial,Shade', 'Notes:textarea']],
      ['pets', 'Pets', 'paw', 'Pet details, vet visits and vaccines', ['Name:text', 'Species:text', 'Breed:text', 'Birthday:date', 'Vet:text', 'Next vaccination:date', 'Notes:textarea']],
      ['rent', 'Rent & Property', 'house', 'Rent payments or rental property', ['Property:text', 'Tenant / landlord:text', 'Month:month', 'Rent:decimal', 'Paid:checkbox', 'Paid on:date', 'Receipt:file']],
      ['utilities-meter', 'Meter Readings', 'gauge', 'Electricity, water and gas readings', ['Date:date', 'Meter:select=Electricity,Water,Gas', 'Reading:decimal', 'Units used:decimal', 'Cost:decimal']],
      ['chores', 'Chores', 'broom', 'Household chores and who does them', ['Chore:text', 'Assigned to:text', 'Frequency:select=Daily,Weekly,Monthly', 'Last done:date', 'Done:checkbox']],
      ['moving', 'Moving Checklist', 'truck-moving', 'Everything to do when moving', ['Task:text', 'Category:select=Packing,Utilities,Address change,Transport,Other', 'Due:date', 'Done:checkbox', 'Notes:text']],
    ],
  },
  {
    id: 'travel',
    label: 'Travel & Vehicles',
    color: '#4FA6E8',
    templates: [
      ['trips', 'Trips', 'plane', 'Trips planned and taken', ['Destination:text', 'Start:date', 'End:date', 'Purpose:select=Leisure,Business,Family,Other', 'Budget:decimal', 'Status:select=Planning,Booked,Completed', 'Notes:textarea']],
      ['bookings', 'Bookings', 'ticket', 'Flights, trains, hotels and tickets', ['Booking:text', 'Type:select=Flight,Train,Bus,Hotel,Car rental,Event,Other', 'Date:datetime', 'Confirmation #:text', 'Amount:decimal', 'Ticket:file']],
      ['packing', 'Packing List', 'suitcase', 'What to pack for a trip', ['Item:text', 'Category:select=Clothes,Toiletries,Electronics,Documents,Medicines,Other', 'Quantity:number', 'Packed:checkbox']],
      ['places', 'Places to Visit', 'map-location-dot', 'Bucket list of places', ['Place:text', 'Country:text', 'Best season:text', 'Visited:checkbox', 'Map link:link', 'Notes:textarea']],
      ['vehicles', 'Vehicles', 'car', 'Vehicle details and documents', ['Vehicle:text', 'Registration #:text', 'Make / model:text', 'Year:year', 'Insurance until:date', 'Pollution cert until:date', 'Documents:file']],
      ['vehicle-service', 'Vehicle Service Log', 'wrench', 'Servicing and repairs', ['Vehicle:text', 'Date:date', 'Odometer (km):number', 'Work done:textarea', 'Cost:decimal', 'Garage:text', 'Next service:date']],
      ['fuel', 'Fuel Log', 'gas-pump', 'Fuel fills and mileage', ['Date:date', 'Vehicle:text', 'Litres:decimal', 'Price per litre:decimal', 'Total:decimal', 'Odometer (km):number']],
      ['frequent-flyer', 'Travel Loyalty', 'plane-departure', 'Airline and hotel loyalty accounts', ['Program:text', 'Member #:text', 'Tier:text', 'Points / miles:number', 'Password:password', 'Login URL:link']],
    ],
  },
  {
    id: 'media',
    label: 'Media & Hobbies',
    color: '#B47FE8',
    templates: [
      ['movies', 'Movies & Shows', 'film', 'Watchlist and ratings', ['Title:text', 'Type:select=Movie,Series,Documentary,Anime', 'Platform:text', 'Status:select=To watch,Watching,Watched', 'Rating:range', 'Watched on:date']],
      ['music', 'Music', 'music', 'Albums, songs and playlists', ['Title:text', 'Artist:text', 'Album:text', 'Genre:text', 'Link:link', 'Favourite:checkbox']],
      ['games', 'Games', 'gamepad', 'Games owned, playing and finished', ['Game:text', 'Platform:select=PC,PlayStation,Xbox,Switch,Mobile,Other', 'Status:select=Backlog,Playing,Finished,Dropped', 'Hours played:number', 'Rating:range']],
      ['podcasts', 'Podcasts', 'podcast', 'Podcasts and episodes to listen to', ['Podcast:text', 'Episode:text', 'Link:link', 'Listened:checkbox', 'Notes:textarea']],
      ['photography', 'Photo Shoots', 'camera', 'Shoots, gear and settings', ['Shoot:text', 'Date:date', 'Location:text', 'Camera / lens:text', 'Settings:text', 'Album link:link']],
      ['collections', 'Collections', 'gem', 'Coins, stamps, cards or anything you collect', ['Item:text', 'Category:text', 'Year:year', 'Condition:select=Mint,Excellent,Good,Fair,Poor', 'Value:decimal', 'Photo:file']],
      ['events', 'Events', 'calendar-plus', 'Concerts, meetups and events', ['Event:text', 'Date:datetime', 'Venue:text', 'Ticket:file', 'Cost:decimal', 'Attended:checkbox']],
      ['sports', 'Sports Matches', 'futbol', 'Matches played or watched', ['Date:date', 'Sport:text', 'Opponent / teams:text', 'Score:text', 'Result:select=Won,Lost,Draw', 'Notes:textarea']],
      ['drawing', 'Art Projects', 'paintbrush', 'Drawings, paintings and crafts', ['Title:text', 'Medium:text', 'Started:date', 'Finished:checkbox', 'Photo:file', 'Notes:textarea']],
    ],
  },
  {
    id: 'legal',
    label: 'Legal & Government',
    color: '#8B93A5',
    templates: [
      ['legal-cases', 'Legal Cases', 'gavel', 'Cases, hearings and lawyers', ['Case:text', 'Case #:text', 'Court:text', 'Lawyer:text', 'Next hearing:date', 'Status:select=Open,Adjourned,Closed', 'Notes:textarea']],
      ['property-docs', 'Property Documents', 'file-signature', 'Deeds, agreements and registrations', ['Document:text', 'Property:text', 'Registration #:text', 'Date:date', 'Stored at:text', 'Scan:file']],
      ['company-registrations', 'Company Registrations', 'building', 'GST, PAN, CIN and other registrations', ['Registration:select=GST,PAN,TAN,CIN,MSME,Trade licence,Other', 'Number:text', 'Issued:date', 'Valid until:date', 'Portal login:text', 'Password:password', 'Certificate:file']],
      ['government-portals', 'Government Portals', 'landmark', 'Logins for government websites', ['Portal:text', 'URL:link', 'Username:text', 'Password:password', 'Linked mobile:tel', 'Notes:textarea']],
      ['wills', 'Wills & Nominees', 'scroll', 'Nominees across accounts and policies', ['Account / asset:text', 'Nominee:text', 'Relation:text', 'Share %:decimal', 'Updated on:date']],
    ],
  },
];

// "Label:type", "Label:type=Opt1,Opt2" or "Label:type:auto" → a builder column.
function parseColumn(spec) {
  const firstColon = spec.indexOf(':');
  const label = spec.slice(0, firstColon);
  let rest = spec.slice(firstColon + 1);
  let options = '';
  const eq = rest.indexOf('=');
  if (eq !== -1) {
    options = rest.slice(eq + 1);
    rest = rest.slice(0, eq);
  }
  const [fieldType, flag] = rest.split(':');
  return { label, field_type: fieldType, options, auto_increment: flag === 'auto' };
}

export const TEMPLATE_GROUPS = GROUPS.map((g) => ({ id: g.id, label: g.label, color: g.color }));

export const TRACK_TEMPLATES = GROUPS.flatMap((g) =>
  g.templates.map(([id, name, icon, description, columns]) => ({
    id,
    name,
    description,
    group: g.id,
    groupLabel: g.label,
    color: g.color,
    icon: `fa-solid fa-${icon}`,
    columns: columns.map(parseColumn),
  }))
);

export function findTemplate(id) {
  return TRACK_TEMPLATES.find((t) => t.id === id) || null;
}
