// A catalog of 1000 online-tool ideas, grouped by category (from
// 1000_online_utility_tools.csv). This drives the Tools → "All tools" directory:
// a browsable, searchable index. A handful are fully built (see REAL_TOOLS in
// toolRegistry); the rest are listed as "planned" and get a detail page.
//
// Kept compact: only the category → tool-name lists live here; slug, blurb and
// the Pro tier are derived below.

import { MINI_TOOL_SLUGS } from './miniTools';
import { PDF_TOOL_SLUGS } from './pdfFileTools';
import { IMAGE_TOOL_SLUGS } from './imageTools';
import { QR_TOOL_SLUGS } from './qrTools';
import { MEDIA_TOOL_SLUGS } from './mediaTools';

export const CATEGORIES = {
  PDF: ['Merge', 'Split', 'Compress', 'Convert to Word', 'Convert to Excel', 'Convert to JPG', 'Convert to PNG', 'Convert to PPT', 'Convert to TXT', 'OCR Text Extractor', 'Password Protector', 'Page Reorder', 'Page Rotator', 'Watermark', 'Sign', 'Metadata Viewer', 'Metadata Remover', 'Compare Documents', 'Summarizer', 'Form Filler', 'Image to PDF', 'Add Page Numbers', 'Delete Pages'],
  Images: ['Format Converter', 'Compressor', 'Resizer', 'Cropper', 'Background Remover', 'Upscaler', 'Denoiser', 'Watermark', 'Collage Maker', 'Color Picker', 'Text Extractor (OCR)', 'Metadata Viewer', 'Metadata Remover', 'Duplicate Finder', 'Blur Tool', 'Border Maker', 'Rounded Corners Tool', 'Image Splitter', 'Image Combiner', 'Transparent Background Maker', 'Rotate', 'Flip', 'Grayscale'],
  Video: ['Format Converter', 'Compressor', 'Resizer', 'Trimmer', 'Merger', 'Splitter', 'GIF Maker', 'Subtitle Generator', 'Subtitle Editor', 'Audio Extractor', 'Thumbnail Maker', 'Watermark', 'Speed Changer', 'Aspect Ratio Converter', 'Frame Extractor', 'Noise Remover', 'Caption Generator', 'Video-to-Text', 'Clip Summarizer', 'File Size Estimator'],
  Audio: ['Format Converter', 'Compressor', 'Trimmer', 'Merger', 'Splitter', 'Noise Remover', 'Voice Recorder', 'Speech-to-Text', 'Text-to-Speech', 'Volume Normalizer', 'Audio Speed Changer', 'Pitch Changer', 'Silence Remover', 'Podcast Clip Maker', 'Metadata Editor', 'Waveform Generator', 'Audio Transcriber', 'Audio Summarizer', 'Karaoke Maker', 'Audio-to-MIDI Converter'],
  Documents: ['Format Converter', 'Word Counter', 'Character Counter', 'Page Counter', 'Merge Documents', 'Split Document', 'Compare Documents', 'Grammar Checker', 'Spell Checker', 'Paraphraser', 'Summarizer', 'Translator', 'Text Extractor', 'Watermark', 'Password Protector', 'Template Generator', 'Citation Formatter', 'Readability Checker', 'Redaction Tool', 'Document Q&A'],
  Spreadsheets: ['CSV-to-XLSX Converter', 'XLSX-to-CSV Converter', 'Formula Explainer', 'Formula Generator', 'Duplicate Row Finder', 'Duplicate Remover', 'Data Cleaner', 'Column Merger', 'Column Splitter', 'Table Formatter', 'Pivot Table Helper', 'Chart Generator', 'Spreadsheet Compare', 'Blank Row Remover', 'Date Formatter', 'Currency Formatter', 'Data Validator', 'CSV Previewer', 'Excel-to-PDF Converter', 'Spreadsheet Summarizer'],
  Presentations: ['PPT-to-PDF Converter', 'PDF-to-PPT Converter', 'Slide Numbering Tool', 'Theme Color Extractor', 'Slide Image Exporter', 'Presentation Compressor', 'Slide Merger', 'Slide Splitter', 'Speaker Notes Generator', 'AI Outline Maker', 'Slide Summarizer', 'Presentation Translator', 'Font Checker', 'Aspect Ratio Converter', 'Slide Timer', 'Quiz-from-Slides Maker', 'Citation Inserter', 'Template Finder', 'Presentation Accessibility Checker', 'Presentation-to-Video Planner'],
  Text: ['Case Converter', 'Whitespace Cleaner', 'Duplicate Line Remover', 'Line Sorter', 'Text Reverser', 'Slug Generator', 'Diff Checker', 'Word Frequency Counter', 'Lorem Ipsum Generator', 'Fancy Text Generator', 'Text-to-ASCII Converter', 'ASCII-to-Text Converter', 'Markdown Formatter', 'Markdown Previewer', 'Text Encryptor', 'Text Decryptor', 'Find-and-Replace Tool', 'Text Splitter', 'Text Joiner', 'Reading Time Calculator'],
  Developer: ['JSON Formatter', 'JSON Validator', 'XML Formatter', 'YAML-to-JSON Converter', 'HTML Formatter', 'CSS Minifier', 'JavaScript Minifier', 'SQL Formatter', 'Regex Tester', 'Base64 Encoder', 'Base64 Decoder', 'URL Encoder', 'URL Decoder', 'JWT Decoder', 'UUID Generator', 'Hash Generator', 'Cron Builder', 'Color Code Converter', 'Timestamp Converter', 'Diff Checker'],
  Websites: ['Website Screenshot Tool', 'Favicon Generator', 'Robots.txt Generator', 'Sitemap Generator', 'Meta Tag Generator', 'Open Graph Previewer', 'Broken Link Checker', 'Redirect Checker', 'HTTP Header Viewer', 'SSL Expiry Checker', 'DNS Lookup', 'WHOIS Lookup', 'Website Speed Checker', 'Mobile Previewer', 'HTML Validator', 'Accessibility Checker', 'Canonical URL Checker', 'Structured Data Tester', 'Page Size Checker', 'Uptime Monitor'],
  SEO: ['Keyword Grouper', 'Keyword Density Checker', 'SERP Snippet Previewer', 'Title Tag Checker', 'Meta Description Checker', 'Heading Analyzer', 'Internal Link Checker', 'Backlink Tracker', 'Rank Tracker', 'Robots.txt Tester', 'Sitemap Validator', 'Schema Generator', 'Redirect Mapper', 'Duplicate Content Checker', 'Readability Analyzer', 'Image Alt Checker', 'Canonical Checker', 'SEO Audit Report Maker', 'Keyword Idea Generator', 'Content Brief Generator'],
  'QR & Barcodes': ['QR Code Generator', 'QR Code Reader', 'Bulk QR Generator', 'Wi-Fi QR Maker', 'Contact QR Maker', 'URL QR Maker', 'Email QR Maker', 'SMS QR Maker', 'Location QR Maker', 'Event QR Maker', 'Payment QR Planner', 'QR Color Customizer', 'QR Logo Inserter', 'QR Print Sheet Maker', 'QR Batch Renamer', 'Barcode Generator', 'Barcode Reader', 'EAN Validator', 'UPC Validator', 'QR Scan Test Tool'],
  Calculators: ['Percentage Calculator', 'Age Calculator', 'Date Difference Calculator', 'Time Duration Calculator', 'BMI Calculator', 'Unit Converter', 'Length Converter', 'Weight Converter', 'Temperature Converter', 'Area Calculator', 'Volume Calculator', 'Speed Converter', 'Fuel Cost Calculator', 'Discount Calculator', 'Tip Calculator', 'Tax Calculator', 'GST Calculator', 'EMI Calculator', 'Compound Interest Calculator', 'Break-Even Calculator'],
  Finance: ['Budget Planner', 'Expense Splitter', 'Invoice Generator', 'Receipt Maker', 'Quotation Generator', 'Profit Margin Calculator', 'Markup Calculator', 'Loan Repayment Calculator', 'SIP Calculator', 'Savings Goal Calculator', 'Currency Converter', 'Sales Tax Calculator', 'GST Invoice Maker', 'Depreciation Calculator', 'Freelance Rate Calculator', 'Salary Calculator', 'Overtime Calculator', 'Subscription Cost Tracker', 'Cash Flow Planner', 'Late Fee Calculator'],
  Business: ['Business Name Generator', 'Slogan Generator', 'Proposal Builder', 'Contract Checklist Maker', 'Meeting Minutes Generator', 'Business Plan Outline Maker', 'Client Intake Form Builder', 'Appointment Scheduler', 'Team Task Tracker', 'Timesheet Calculator', 'Purchase Order Maker', 'Inventory Calculator', 'Profit Calculator', 'Break-Even Analyzer', 'Customer Survey Builder', 'Feedback Form Builder', 'Policy Template Maker', 'SOP Generator', 'Business Card Maker', 'QR Contact Card Maker'],
  Marketing: ['UTM Builder', 'Campaign URL Builder', 'Email Subject Tester', 'Headline Generator', 'Ad Copy Generator', 'Landing Page Copy Helper', 'A/B Test Calculator', 'Marketing Calendar Maker', 'Lead Magnet Planner', 'Audience Persona Builder', 'Hashtag Generator', 'Content Repurposing Planner', 'Campaign ROI Calculator', 'Coupon Code Generator', 'Referral Link Builder', 'Review Response Writer', 'Brand Voice Checker', 'CTA Generator', 'Competitor Comparison Table Maker', 'Marketing Report Generator'],
  'Social Media': ['Post Scheduler', 'Caption Generator', 'Hashtag Research Tool', 'Bio Generator', 'Profile Picture Resizer', 'Post Image Resizer', 'Carousel Splitter', 'Reel Cover Maker', 'Thumbnail Maker', 'Content Calendar Maker', 'Caption Formatter', 'Video Subtitle Maker', 'Comment Reply Helper', 'Post Previewer', 'Engagement Rate Calculator', 'Giveaway Picker', 'Link-in-Bio Page Builder', 'Social Profile Audit', 'Cross-Platform Text Formatter', 'Short-Video Hook Generator'],
  Design: ['Color Palette Generator', 'Gradient Generator', 'Font Pairing Tool', 'Contrast Checker', 'SVG Optimizer', 'Icon Finder', 'Favicon Maker', 'CSS Shadow Generator', 'Border Radius Generator', 'Spacing Scale Generator', 'Design Token Exporter', 'Palette Extractor', 'Pattern Generator', 'Mockup Maker', 'Wireframe Generator', 'Logo Brief Generator', 'Brand Kit Maker', 'Typography Scale Calculator', 'Design Size Converter', 'Print Bleed Calculator'],
  'Files & Archives': ['ZIP Creator', 'ZIP Extractor', 'RAR File Inspector', '7Z Extractor', 'File Type Detector', 'File Renamer', 'Bulk File Renamer', 'Folder Size Calculator', 'Duplicate File Finder', 'File Checksum Calculator', 'Checksum Verifier', 'File Splitter', 'File Joiner', 'Temporary File Cleaner Guide', 'File List Exporter', 'Archive Password Checklist', 'Batch Extension Changer', 'File Comparison Tool', 'MIME Type Lookup', 'Large File Transfer Planner'],
  'Security & Privacy': ['Password Generator', 'Password Strength Checker', 'Passphrase Generator', 'Hash Calculator', 'File Checksum Verifier', 'Metadata Remover', 'Privacy Policy Generator', 'Cookie Banner Planner', 'Data Redaction Tool', 'Secret Scanner', 'URL Safety Checklist', 'Email Header Analyzer', 'Permission Audit Checklist', '2FA Backup Code Organizer', 'Password Expiry Planner', 'Secure Note Generator', 'Random Token Generator', 'Text Masking Tool', 'PII Detection Helper', 'Security Headers Checker'],
  Email: ['Email Signature Generator', 'Email Template Builder', 'Email Subject Line Generator', 'Email Validator', 'Bulk Email List Cleaner', 'Email Domain Checker', 'MX Record Lookup', 'Email Header Analyzer', 'Unsubscribe Link Checker', 'Inbox Zero Planner', 'Email-to-Task Converter', 'Follow-up Reminder Planner', 'Cold Email Personalizer', 'Email Preview Tester', 'HTML Email Formatter', 'Email Text Extractor', 'Email Thread Summarizer', 'Meeting Request Generator', 'Out-of-Office Message Maker', 'Email Tone Checker'],
  Education: ['Flashcard Maker', 'Quiz Generator', 'Multiple Choice Test Maker', 'Study Timetable Planner', 'Citation Generator', 'Bibliography Formatter', 'Reading Time Calculator', 'Grade Calculator', 'GPA Calculator', 'Math Equation Formatter', 'Periodic Table Lookup', 'Unit Conversion Practice Maker', 'Essay Outline Builder', 'Vocabulary Quiz Maker', 'Language Practice Generator', 'Lesson Plan Builder', 'Worksheet Generator', 'Exam Countdown Calculator', 'Study Notes Summarizer', 'PDF-to-Flashcards Tool'],
  Language: ['Text Translator', 'Grammar Checker', 'Spell Checker', 'Pronunciation Guide', 'Transliteration Tool', 'Roman-to-Devanagari Converter', 'Devanagari-to-Roman Converter', 'Language Detector', 'Vocabulary Builder', 'Verb Conjugation Helper', 'Pluralization Checker', 'Sentence Simplifier', 'Tone Rewriter', 'Reading Level Converter', 'Subtitle Translator', 'Dictionary Lookup', 'Synonym Finder', 'Antonym Finder', 'Text-to-IPA Helper', 'Bilingual Glossary Maker'],
  'AI Writing': ['Email Drafter', 'Blog Outline Generator', 'Blog Title Generator', 'Product Description Writer', 'Resume Bullet Improver', 'Cover Letter Writer', 'Meeting Summary Generator', 'Action Item Extractor', 'Long Text Summarizer', 'Text Rewriter', 'Tone Changer', 'FAQ Generator', 'Question Generator', 'Social Caption Writer', 'Press Release Drafter', 'Job Description Writer', 'Proposal Draft Helper', 'Report Outline Generator', 'Document Q&A', 'Custom Prompt Builder'],
  'AI Research': ['PDF Q&A', 'Multi-Document Q&A', 'Research Paper Summarizer', 'Citation Extractor', 'Source Comparison Tool', 'Fact-Check Checklist Maker', 'Literature Review Outliner', 'Research Question Generator', 'Survey Result Summarizer', 'Interview Transcript Analyzer', 'Meeting Transcript Summarizer', 'Long Article Summarizer', 'Webpage Summary Helper', 'Table Extractor', 'Data Insight Explainer', 'Research Timeline Maker', 'Evidence Matrix Builder', 'Claim Extractor', 'Glossary Extractor', 'Study Guide Generator'],
  'AI Images': ['Text-to-Image Prompt Builder', 'Image Caption Generator', 'Image Alt Text Generator', 'Background Removal', 'Image Upscaler', 'Photo Restoration', 'Image Colorizer', 'Object Removal Planner', 'Product Photo Background Maker', 'Portrait Retouch Helper', 'Image Variation Generator', 'Image-to-Prompt Tool', 'Image Similarity Checker', 'Image Crop Suggestion Tool', 'Thumbnail Concept Generator', 'Poster Prompt Builder', 'Logo Prompt Builder', 'Social Graphic Prompt Builder', 'Image OCR', 'Image Description Generator'],
  'AI Audio & Video': ['Audio Transcriber', 'Video Summarizer', 'Subtitle Generator', 'Caption Formatter', 'Speaker Labeling Helper', 'Podcast Show Notes Generator', 'Clip Idea Finder', 'Short-Video Script Writer', 'Voiceover Script Writer', 'Audio Translation Helper', 'Silence Detection Tool', 'Transcript Cleaner', 'Chapter Marker Generator', 'Interview Highlight Finder', 'Meeting Action Extractor', 'Video Title Generator', 'Podcast Title Generator', 'Audio-to-Text Converter', 'Video-to-Text Converter', 'Subtitle File Converter'],
  'HR & Careers': ['Resume Builder', 'CV Formatter', 'Cover Letter Builder', 'LinkedIn Summary Writer', 'Interview Question Generator', 'Interview Practice Tool', 'Job Description Analyzer', 'Skills Gap Checklist', 'Salary Comparison Calculator', 'Notice Period Calculator', 'Leave Balance Calculator', 'Shift Schedule Planner', 'Timesheet Calculator', 'Candidate Scorecard Maker', 'Performance Review Template', 'Onboarding Checklist Maker', 'Offer Letter Checklist', 'Job Application Tracker', 'Reference Request Email Maker', 'Career Roadmap Builder'],
  'E-commerce': ['Product Description Writer', 'SKU Generator', 'Barcode Label Maker', 'Shipping Cost Calculator', 'Product Image Resizer', 'Background Remover', 'Bulk Listing Formatter', 'Product Feed Validator', 'Return Policy Checklist', 'Order Profit Calculator', 'Discount Calculator', 'Bundle Pricing Calculator', 'Stock Reorder Calculator', 'Inventory CSV Cleaner', 'Review Response Writer', 'Product Comparison Table Maker', 'Marketplace Fee Calculator', 'Size Chart Maker', 'Shipping Label Layout Planner', 'Product FAQ Generator'],
  Travel: ['Trip Budget Calculator', 'Packing List Generator', 'Time Zone Converter', 'Travel Itinerary Builder', 'Distance Calculator', 'Fuel Cost Calculator', 'Currency Converter', 'Date Countdown', 'Jet Lag Schedule Planner', 'Flight Duration Calculator', 'Hotel Split Cost Calculator', 'Road Trip Planner', 'Travel Checklist Maker', 'Luggage Weight Converter', 'World Clock', 'Travel Phrase Helper', 'Trip Expense Splitter', 'Visa Document Checklist', 'Travel Insurance Comparison Sheet', 'Local Time Meeting Planner'],
  'Home & Lifestyle': ['Room Area Calculator', 'Paint Quantity Calculator', 'Wallpaper Calculator', 'Tile Calculator', 'Furniture Layout Planner', 'Moving Checklist Maker', 'Cleaning Schedule Maker', 'Chore Rotator', 'Grocery List Builder', 'Meal Plan Generator', 'Recipe Unit Converter', 'Water Intake Reminder Planner', 'Plant Watering Schedule', 'Electricity Cost Calculator', 'Appliance Energy Calculator', 'Home Budget Planner', 'Rent Split Calculator', 'Storage Volume Calculator', 'Garden Spacing Calculator', 'DIY Material Estimator'],
  'Health & Fitness': ['Workout Planner', 'Running Pace Calculator', 'Calorie Estimate Calculator', 'BMI Calculator', 'Body Fat Estimate Worksheet', 'Heart Rate Zone Calculator', 'Step Distance Calculator', 'Training Log Builder', 'Rest Timer', 'Hydration Reminder Planner', 'Sleep Schedule Planner', 'Macro Calculator', 'One-Rep Max Calculator', 'Race Time Predictor', 'Walking Speed Calculator', 'Cycling Pace Calculator', 'Stretching Routine Planner', 'Habit Tracker', 'Meal Prep Planner', 'Fitness Progress Chart Maker'],
  'Food & Cooking': ['Recipe Scaler', 'Ingredient Unit Converter', 'Oven Temperature Converter', 'Cooking Time Planner', 'Meal Planner', 'Grocery List Generator', 'Nutrition Label Calculator', 'Recipe Cost Calculator', 'Food Cost Percentage Calculator', 'Portion Calculator', "Baker's Percentage Calculator", 'Coffee Ratio Calculator', 'Tea Timer', 'Kitchen Measurement Converter', 'Substitution Finder', 'Weekly Menu Planner', 'Leftover Planner', 'Party Food Quantity Calculator', 'Recipe Formatter', 'Recipe Card Maker'],
  'Real Estate': ['Mortgage Calculator', 'Rent vs Buy Calculator', 'Rental Yield Calculator', 'Property ROI Calculator', 'Area Unit Converter', 'Room Measurement Planner', 'Stamp Duty Estimator', 'Home Affordability Calculator', 'Down Payment Calculator', 'Rent Split Calculator', 'Property Listing Description Writer', 'Open House Checklist Maker', 'Maintenance Cost Planner', 'Moving Cost Calculator', 'Lease Date Calculator', 'Property Comparison Sheet', 'Real Estate Flyer Maker', 'Rental Application Checklist', 'Floor Plan Area Calculator', 'Property Investment Tracker'],
  'Events & Invitations': ['Invitation Maker', 'RSVP Form Builder', 'Guest List Manager', 'Seating Plan Maker', 'Event Budget Calculator', 'Ticket QR Generator', 'Event Countdown', 'Wedding Budget Planner', 'Birthday Invitation Maker', 'Certificate Generator', 'Name Badge Maker', 'Table Number Generator', 'Event Schedule Builder', 'Thank-You Card Maker', 'Photo Booth Frame Maker', 'Event Feedback Form', 'Gift Tracker', 'Party Food Calculator', 'Event Poster Resizer', 'Digital Invitation Link Maker'],
  Photography: ['EXIF Viewer', 'Photo Contact Sheet Maker', 'Photo Batch Renamer', 'Photo Metadata Cleaner', 'Lens Field-of-View Calculator', 'Depth-of-Field Calculator', 'Exposure Calculator', 'Golden Hour Planner', 'Aspect Ratio Calculator', 'Print Size Calculator', 'DPI Calculator', 'Photo Watermark Tool', 'Photo Comparison Slider Maker', 'Photo Archive Organizer', 'Duplicate Photo Finder', 'RAW-to-JPG Planner', 'Photo Backup Checklist', 'Color Profile Checker', 'Photo Naming Template Generator', 'Client Proofing Gallery Planner'],
  'Data & Analytics': ['CSV Viewer', 'CSV Cleaner', 'JSON-to-CSV Converter', 'Data Deduplicator', 'Data Validator', 'Column Statistics Tool', 'Data Type Detector', 'Date Normalizer', 'Phone Number Formatter', 'Address Formatter', 'Data Masking Tool', 'Random Dataset Generator', 'Sample Data Generator', 'Chart Maker', 'Pivot Table Helper', 'Correlation Calculator', 'Percentage Change Calculator', 'Cohort Table Template Maker', 'Survey Data Summarizer', 'Data Dictionary Generator'],
  Networking: ['IP Lookup', 'Subnet Calculator', 'CIDR Calculator', 'IPv4-to-IPv6 Reference Tool', 'DNS Lookup', 'MX Lookup', 'Port Reference Lookup', 'Ping Result Formatter', 'Traceroute Output Analyzer', 'Bandwidth Calculator', 'Transfer Time Calculator', 'Latency Calculator', 'Wi-Fi QR Maker', 'MAC Address Formatter', 'IP Range Generator', 'WHOIS Lookup', 'SSL Expiry Checker', 'HTTP Status Lookup', 'User-Agent Parser', 'Network Checklist Maker'],
  'Cloud & DevOps': ['Cron Builder', 'YAML Validator', 'Docker Compose Formatter', 'Dockerfile Linter Checklist', 'Environment File Validator', 'Log File Analyzer', 'Log Timestamp Converter', 'JSON Log Formatter', 'Uptime Calculator', 'Deployment Checklist Maker', 'Release Notes Generator', 'Changelog Formatter', 'Semantic Version Calculator', 'Config Diff Checker', 'Kubernetes YAML Formatter', 'CI Pipeline Template Maker', 'Backup Size Calculator', 'Storage Cost Calculator', 'Incident Report Generator', 'Runbook Template Maker'],
  Database: ['SQL Formatter', 'SQL Query Explainer', 'CSV-to-SQL Insert Generator', 'SQL-to-JSON Converter', 'Schema Diagram Planner', 'ER Diagram Maker', 'Sample Data Generator', 'Database Seed Generator', 'SQL Diff Checker', 'Query Result Formatter', 'Connection String Builder', 'Index Checklist Maker', 'Data Type Converter', 'Date Query Helper', 'JSON-to-SQL Generator', 'SQL-to-CSV Export Helper', 'Migration Checklist Maker', 'Backup Schedule Planner', 'Database Size Calculator', 'Table Documentation Generator'],
  'Project Management': ['Kanban Board', 'Gantt Chart Maker', 'Timeline Generator', 'Sprint Capacity Calculator', 'Story Point Calculator', 'Workload Planner', 'RACI Matrix Maker', 'Risk Register Builder', 'Retrospective Board', 'Meeting Agenda Maker', 'Action Item Tracker', 'Project Budget Calculator', 'Milestone Tracker', 'Dependency Mapper', 'Project Status Report Maker', 'Task Estimate Calculator', 'Time Tracking Sheet', 'Resource Allocation Planner', 'Decision Log Maker', 'Project Brief Generator'],
  Productivity: ['Pomodoro Timer', 'Focus Session Tracker', 'Habit Tracker', 'Daily Planner', 'Weekly Planner', 'Time Blocking Planner', 'Meeting Cost Calculator', 'Task Prioritizer', 'Eisenhower Matrix Maker', 'Goal Tracker', 'Decision Matrix Calculator', 'Personal Kanban Board', 'Routine Builder', 'Reminder Checklist Maker', 'Time Audit Calculator', 'Reading List Organizer', 'Bookmark Organizer', 'Personal Dashboard Planner', 'Recurring Task Planner', 'Distraction Log'],
  'Forms & Surveys': ['Contact Form Builder', 'Feedback Form Builder', 'Customer Survey Maker', 'Poll Creator', 'Quiz Form Builder', 'Registration Form Builder', 'Lead Capture Form', 'RSVP Form Builder', 'NPS Calculator', 'Survey Result Summarizer', 'Form-to-CSV Exporter', 'Form Validation Tester', 'Conditional Logic Planner', 'Consent Form Template Maker', 'Application Form Builder', 'Anonymous Suggestion Box', 'Questionnaire Generator', 'Form QR Code Maker', 'Response Deduplicator', 'Survey Completion Time Estimator'],
  Accessibility: ['Color Contrast Checker', 'Alt Text Generator', 'Image Accessibility Checker', 'Heading Structure Checker', 'Link Text Checker', 'Keyboard Navigation Checklist', 'ARIA Attribute Reference', 'Caption File Validator', 'Transcript Completeness Checker', 'Readable Font Size Checker', 'Plain Language Rewriter', 'Accessible PDF Checklist', 'Form Label Checker', 'Focus Order Planner', 'Color Blindness Simulator', 'Accessible Color Palette Maker', 'PDF Reading Order Checklist', 'Link Purpose Checker', 'Accessibility Statement Generator', 'WCAG Audit Report Template'],
  'Privacy & Compliance': ['Privacy Policy Draft Helper', 'Cookie Policy Draft Helper', 'Cookie Banner Planner', 'Data Retention Schedule Maker', 'Consent Log Template', 'Data Processing Register', 'PII Detector', 'Document Redaction Tool', 'Metadata Cleaner', 'Data Breach Checklist Maker', 'DSAR Request Tracker', 'Vendor Risk Questionnaire', 'Compliance Calendar', 'Policy Review Reminder Planner', 'Terms Checklist Maker', 'Data Classification Helper', 'Retention Date Calculator', 'Access Review Checklist', 'Privacy Notice Summarizer', 'Compliance Evidence Tracker'],
  'Shopping & Comparison': ['Price Comparison Sheet Maker', 'Unit Price Calculator', 'Discount Comparison Calculator', 'Coupon Savings Calculator', 'Warranty Expiry Tracker', 'Purchase Decision Matrix', 'Product Specification Comparator', 'Subscription Comparison Calculator', 'Shipping Cost Comparator', 'Bulk Buy Calculator', 'Price-per-Weight Calculator', 'Shopping List Planner', 'Gift Budget Calculator', 'Return Window Calculator', 'Price History Tracker Template', 'Feature Comparison Table Maker', 'Review Summary Helper', 'Total Cost of Ownership Calculator', 'Installment Cost Calculator', 'Purchase Receipt Organizer'],
  'Legal & Admin': ['Document Checklist Maker', 'Contract Deadline Calculator', 'Renewal Reminder Planner', 'Meeting Minutes Template', 'Affidavit Formatting Helper', 'Declaration Template Maker', 'Document Redaction Tool', 'Signature Page Maker', 'Policy Template Builder', 'Record Retention Planner', 'Case Timeline Builder', 'Evidence Index Maker', 'Legal Glossary Lookup', 'Clause Comparison Tool', 'Agreement Summary Helper', 'Form Field Extractor', 'Document Version Comparator', 'Filing Checklist Maker', 'Appointment Letter Template', 'Notice Draft Helper'],
  'Creator Tools': ['YouTube Title Generator', 'Video Description Generator', 'Thumbnail Text Planner', 'Podcast Show Notes Maker', 'Stream Overlay Planner', 'Content Calendar Maker', 'Creator Rate Calculator', 'Sponsorship Proposal Builder', 'Media Kit Maker', 'Affiliate Disclosure Generator', 'Video Chapter Generator', 'Shorts Hook Generator', 'Caption File Formatter', 'Royalty Split Calculator', 'Creator Invoice Maker', 'Brand Deal Tracker', 'Content Repurposing Planner', 'Upload Checklist Maker', 'Audience Poll Generator', 'Content Performance Report Maker'],
  'Maps & Geography': ['Coordinate Converter', 'Distance Between Coordinates', 'Area from Coordinates Calculator', 'Map Scale Calculator', 'Time Zone by Location Helper', 'GeoJSON Formatter', 'KML-to-GeoJSON Converter', 'GeoJSON Validator', 'Latitude Longitude Formatter', 'Plus Code Helper', 'Address Format Cleaner', 'Country Code Lookup', 'Postal Code Format Checker', 'Route Distance Planner', 'Elevation Profile Planner', 'Coordinate Batch Converter', 'GeoJSON-to-CSV Converter', 'CSV-to-GeoJSON Converter', 'Map Marker List Maker', 'Geographic Data Previewer'],
  'Hacking & CTF': ['Base32 Encoder', 'Base32 Decoder', 'Base58 Encoder', 'Base58 Decoder', 'Hex Encoder', 'Hex Decoder', 'Binary Encoder', 'Binary Decoder', 'Octal Encoder', 'Octal Decoder', 'Decimal Encoder', 'Decimal Decoder', 'HTML Entity Encoder', 'HTML Entity Decoder', 'Unicode Escape Encoder', 'Unicode Escape Decoder', 'Quoted-Printable Encoder', 'Quoted-Printable Decoder', 'Base64URL Encoder', 'Base64URL Decoder', 'Morse Code Encoder', 'Morse Code Decoder', 'Data URI Encoder', 'Data URI Decoder', 'Caesar Cipher Encoder', 'Caesar Cipher Decoder', 'Caesar Brute Force', 'ROT13 Converter', 'ROT47 Converter', 'Atbash Cipher', 'Vigenere Encoder', 'Vigenere Decoder', 'Rail Fence Encoder', 'Rail Fence Decoder', 'XOR Cipher', 'Single-Byte XOR Brute Force', 'Bacon Cipher Encoder', 'Bacon Cipher Decoder', 'A1Z26 Encoder', 'A1Z26 Decoder', 'Affine Cipher Encoder', 'Affine Cipher Decoder', 'Polybius Square Encoder', 'Polybius Square Decoder', 'Substitution Cipher', 'Leetspeak Encoder', 'Leetspeak Decoder', 'NATO Phonetic Encoder', 'MD5 Hash', 'SHA-1 Hash', 'SHA-256 Hash', 'SHA-512 Hash', 'HMAC Generator', 'CRC32 Checksum', 'Adler-32 Checksum', 'Hash Identifier', 'Password Entropy Calculator', 'Random Bytes Generator', 'JWT Signature Verifier', 'JWT Claims Inspector', 'Character Frequency Analyzer', 'Index of Coincidence Calculator', 'Shannon Entropy Calculator', 'Hex Dump Viewer', 'Hex Dump Reverser', 'String Extractor', 'Encoding Detector', 'ASCII Table Reference', 'Regex Escaper', 'Security Headers Analyzer', 'CSP Analyzer', 'Cookie Flag Analyzer', 'HTTP Status Lookup', 'Common Ports Lookup', 'User-Agent Parser', 'URL Parser', 'HTML/JS Escaper', 'IP to Integer', 'Integer to IP', 'IP to Binary', 'IPv6 Expander', 'IPv6 Compressor', 'MAC Address Formatter', 'Subnet Mask Converter'],
  Automotive: ['Fuel Economy Calculator', 'Trip Fuel Cost Calculator', 'EV Charging Cost Calculator', 'Mileage Tracker', 'Service Interval Planner', 'Vehicle Depreciation Calculator', 'Loan EMI Calculator', 'Tyre Size Comparison Calculator', 'Unit Converter for Torque', 'Horsepower Converter', 'Trip Distance Planner', 'Parking Cost Calculator', 'Toll Cost Planner', 'Maintenance Log Maker', 'Vehicle Expense Tracker', 'Insurance Renewal Reminder', 'VIN Format Checker', 'Vehicle Sale Bill Template', 'Fleet Fuel Report Maker', 'Car Running Cost Calculator'],
};

// Which Pro upsell line a category uses (from the CSV's "Possible paid feature").
const TIER_B = new Set(['Developer', 'Websites', 'SEO', 'Networking', 'Cloud & DevOps', 'Database']);
const TIER_C = new Set(['Finance', 'Business', 'HR & Careers', 'E-commerce']);
const TIER_D = new Set(['AI Writing', 'AI Research', 'AI Images', 'AI Audio & Video']);
export function proFeature(category) {
  if (TIER_B.has(category)) return 'Pro: API access, scheduled checks, history, exports, or higher limits';
  if (TIER_C.has(category)) return 'Pro: templates, automation, saved records, reports, or team access';
  if (TIER_D.has(category)) return 'Pro: usage credits, higher limits, premium outputs, or team workspace';
  return 'Pro: batch processing, larger limits, saved history, or export options';
}

export const slugify = (s) =>
  s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Catalog slugs that are already built as real tools (link straight to them).
export const REAL_TOOL_LINKS = {
  'qr-and-barcodes-qr-code-generator': 'qr-generator',
  'images-text-extractor-ocr': 'text-extractor',
  'pdf-ocr-text-extractor': 'text-extractor',
  'images-compressor': 'image-compressor',
  'images-collage-maker': 'photo-editor',
  'video-gif-maker': 'gif-maker',
  'websites-http-header-viewer': 'page-inspector',
  'websites-website-screenshot-tool': 'responsive-tester',
  'websites-broken-link-checker': 'url-checker',
  'networking-ip-lookup': 'ip-locator',
};

export const CATEGORY_LIST = Object.keys(CATEGORIES);

// The curated catalog: only these core utility categories are shown, and within
// them only tools that actually work (built page, mini-tool, or file-tool).
// Everything else (calculators, finance, database, AI, niche, …) is hidden.
export const CORE_CATEGORIES = ['PDF', 'Images', 'Text', 'Developer', 'Websites', 'QR & Barcodes', 'Design', 'SEO', 'Networking', 'Spreadsheets', 'Data & Analytics'];
export const isCoreCategory = (c) => CORE_CATEGORIES.includes(c);

// Individually allow-listed popular tools from non-core categories (the ones
// people actually search for) — calculators, converters, password tools, etc.
// The niche/filler tools in these categories stay hidden.
export const POPULAR_SLUGS = new Set([
  // Calculators (high-demand)
  'calculators-percentage-calculator', 'calculators-age-calculator', 'calculators-date-difference-calculator',
  'calculators-bmi-calculator', 'calculators-unit-converter', 'calculators-length-converter',
  'calculators-weight-converter', 'calculators-temperature-converter', 'calculators-speed-converter',
  'calculators-discount-calculator', 'calculators-tip-calculator', 'calculators-tax-calculator',
  'calculators-gst-calculator', 'calculators-emi-calculator', 'calculators-compound-interest-calculator',
  'calculators-time-duration-calculator', 'calculators-fuel-cost-calculator',
  // Finance (popular)
  'finance-loan-repayment-calculator', 'finance-sip-calculator', 'finance-salary-calculator',
  'finance-profit-margin-calculator', 'finance-markup-calculator',
  // Security (very searched)
  'security-and-privacy-password-generator', 'security-and-privacy-password-strength-checker',
  'security-and-privacy-passphrase-generator', 'security-and-privacy-hash-calculator',
  'security-and-privacy-random-token-generator',
  // Health (popular)
  'health-and-fitness-bmi-calculator', 'health-and-fitness-calorie-estimate-calculator',
  'health-and-fitness-macro-calculator', 'health-and-fitness-running-pace-calculator',
  // Documents / Data (popular)
  'documents-word-counter', 'documents-character-counter', 'data-and-analytics-percentage-change-calculator',
  // Advanced media
  'audio-text-to-speech',
]);

// Show every tool that actually works (the whole suite). Nothing fake or
// "Planned" is shown — only genuinely working tools. Calculators are removed
// entirely: the whole Calculators category and any "…Calculator" tool elsewhere.
const isCalculator = (t) => t.category === 'Calculators' || /calculator/i.test(t.name);
export const isShown = (t) => Boolean(t.working) && !isCalculator(t);
export function curatedTools() {
  return allCatalogTools().filter(isShown);
}
// Every category that has at least one working tool, in catalog order.
export function shownCategories() {
  const set = new Set(allCatalogTools().filter(isShown).map((t) => t.category));
  return CATEGORY_LIST.filter((c) => set.has(c));
}
export const CURATED_COUNT = () => curatedTools().length;

// A Font Awesome icon per category, for the home menu tiles.
export const CATEGORY_ICONS = {
  PDF: 'fa-file-pdf', Images: 'fa-image', Video: 'fa-film', Audio: 'fa-music',
  Documents: 'fa-file-lines', Spreadsheets: 'fa-table-cells', Presentations: 'fa-chalkboard',
  Text: 'fa-font', Developer: 'fa-code', Websites: 'fa-globe', SEO: 'fa-magnifying-glass-chart',
  'QR & Barcodes': 'fa-qrcode', Calculators: 'fa-calculator', Finance: 'fa-sack-dollar',
  Business: 'fa-briefcase', Marketing: 'fa-bullhorn', 'Social Media': 'fa-hashtag',
  Design: 'fa-palette', 'Files & Archives': 'fa-box-archive', 'Security & Privacy': 'fa-shield-halved',
  Email: 'fa-envelope', Education: 'fa-graduation-cap', Language: 'fa-language',
  'AI Writing': 'fa-wand-magic-sparkles', 'AI Research': 'fa-flask', 'AI Images': 'fa-image-portrait',
  'AI Audio & Video': 'fa-headphones', 'HR & Careers': 'fa-user-tie', 'E-commerce': 'fa-cart-shopping',
  Travel: 'fa-plane', 'Home & Lifestyle': 'fa-house', 'Health & Fitness': 'fa-heart-pulse',
  'Food & Cooking': 'fa-utensils', 'Real Estate': 'fa-building', 'Events & Invitations': 'fa-calendar-check',
  Photography: 'fa-camera', 'Data & Analytics': 'fa-chart-column', Networking: 'fa-network-wired',
  'Cloud & DevOps': 'fa-cloud', Database: 'fa-database', 'Project Management': 'fa-diagram-project',
  Productivity: 'fa-bolt', 'Forms & Surveys': 'fa-clipboard-list', Accessibility: 'fa-universal-access',
  'Privacy & Compliance': 'fa-user-shield', 'Shopping & Comparison': 'fa-tags', 'Legal & Admin': 'fa-scale-balanced',
  'Creator Tools': 'fa-video', 'Maps & Geography': 'fa-map-location-dot', Automotive: 'fa-car',
  'Hacking & CTF': 'fa-user-secret',
};
export const categoryIcon = (cat) => CATEGORY_ICONS[cat] || 'fa-toolbox';

// Category menu data for the home page: every shown category and how many
// tools it offers. [{ name, slug, icon, count }]
export function categoryMenu() {
  return shownCategories().map((name) => ({
    name,
    slug: slugify(name),
    icon: categoryIcon(name),
    count: toolsInCategory(name).length,
  }));
}

// Only shown categories resolve; others are treated as removed.
export const categoryBySlug = (slug) => shownCategories().find((c) => slugify(c) === slug) || null;
// Only the shown (working + core/popular) tools in a category are listed.
export function toolsInCategory(category) {
  return allCatalogTools().filter((t) => t.category === category && isShown(t));
}

// Flatten to a numbered list: { no, category, name, slug, href, pro, real }.
let _all = null;
export function allCatalogTools() {
  if (_all) return _all;
  const out = [];
  let no = 0;
  for (const category of CATEGORY_LIST) {
    const catSlug = slugify(category);
    for (const name of CATEGORIES[category]) {
      no += 1;
      const slug = `${catSlug}-${slugify(name)}`;
      const real = REAL_TOOL_LINKS[slug] || null;
      const mini = MINI_TOOL_SLUGS.has(slug);
      const file = PDF_TOOL_SLUGS.has(slug) || IMAGE_TOOL_SLUGS.has(slug) || QR_TOOL_SLUGS.has(slug) || MEDIA_TOOL_SLUGS.has(slug);
      out.push({
        no,
        category,
        name,
        slug,
        href: real ? `/dashboard/tools/${real}` : `/dashboard/tools/catalog/${slug}`,
        pro: proFeature(category),
        real: Boolean(real),
        mini,
        file,
        // "working" = opens a real, usable tool (built page, mini-tool or file-tool).
        working: Boolean(real) || mini || file,
      });
    }
  }
  _all = out;
  return out;
}

export const catalogBySlug = (slug) => allCatalogTools().find((t) => t.slug === slug);
export const CATALOG_COUNT = allCatalogTools().length;
