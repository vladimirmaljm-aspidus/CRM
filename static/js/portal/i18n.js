// Aspidus B2B Portal — English-only labels.
// Client-facing portal is exclusively for international clients; a language
// switcher would only add clutter. Retain the dictionary-based lookup helper
// so existing render sites (t('key')) keep working.

const dict = {
    'en': {
        // Loading / header
        'loading': 'Loading Secure Portal…', 'b2b': 'B2B Client Portal', 'welcome': 'Welcome', 'logout': 'Logout',
        // Tabs
        'dashboard': 'Dashboard', 'shipments': 'Shipments', 'offers': 'Offers', 'rfq': 'My RFQs',
        'kyc_tab': 'KYC / Compliance', 'goods': 'My Products', 'profile': 'Profile', 'documents': 'Documents',
        // Dashboard
        'stat_shipments': 'Active Shipments', 'stat_offers': 'Open Offers', 'stat_rfqs': 'Pending RFQs', 'stat_kyc': 'KYC Status',
        'recent_offers': 'Recent Offers', 'recent_docs': 'Recent Documents', 'view_all_offers': 'View all →', 'view_all_docs': 'View all →',
        // Shipments
        'no_deals': 'No active shipments.', 'contract': 'Contract No.', 'vessel': 'Vessel', 'bl': 'B/L Number', 'pol': 'Port of Loading', 'pod': 'Port of Discharge',
        // Offers
        'no_offers': 'No active offers.', 'offer_no': 'Offer No.', 'valid': 'Valid Until', 'incoterm': 'Incoterm', 'qty': 'Quantity',
        'offer_accepted': 'Accepted', 'offer_declined': 'Declined', 'hs_code': 'HS Code', 'packaging': 'Packaging', 'payment_terms': 'Payment Terms',
        'shipping': 'Shipping', 'specification': 'Specification', 'view_details': 'View Details', 'offer_decline': 'Decline', 'offer_accept': 'Accept Offer',
        'confirm_accept_offer': 'Confirm acceptance of this offer? Your account manager will contact you to finalize the deal.',
        'confirm_decline_offer': 'Are you sure you want to decline this offer?', 'decline_reason': 'Optional reason (visible to admin):',
        'msg_offer_accepted': 'Offer accepted. Thank you!', 'msg_offer_declined': 'Offer declined.',
        'price': 'Price', 'origin': 'Origin', 'lead_time': 'Lead Time', 'notes': 'Notes', 'close': 'Close',
        // RFQ
        'no_rfq': 'No RFQs submitted yet.', 'rfq_main_title': 'Requests for Quotation', 'rfq_main_desc': 'Submit and track your purchasing requests.',
        'rfq_modal_title': 'Submit New RFQ', 'rfq_prod': 'Product / Commodity', 'rfq_qty': 'Target Quantity',
        'rfq_price': 'Target Price (Optional)', 'rfq_notes': 'Notes / Specifications', 'btn_new_rfq': '+ New RFQ', 'btn_rfq_send': 'Send Request', 'btn_rfq_cancel': 'Cancel',
        // Documents
        'docs_title': 'Document Vault', 'docs_desc': 'Download your official offers, invoices and contracts. Every download is logged.',
        'th_doc_date': 'Date', 'th_doc_type': 'Type', 'th_doc_name': 'File', 'th_doc_action': 'Action',
        'no_docs': 'No documents available yet.', 'btn_download': 'View', 'btn_download_pdf': 'View / Download PDF',
        // KYC
        'kyc_title': 'Compliance & KYC', 'kyc_desc': 'Securely submit corporate data. Encrypted in an air-gapped vault.',
        'kyc_current_status': 'Current Status',
        'kyc_status_pending': 'Pending Review', 'kyc_status_approved': 'Approved', 'kyc_status_rejected': 'Rejected',
        'kyc_status_update_requested': 'Update Requested', 'kyc_status_expired': 'Expired',
        'update_req_note_prefix': 'Administrator requested the following updates: ',
        'kyc_sec1': '1. Company Details', 'kyc_sec2': '2. Banking & Financial Profile', 'kyc_sec3': '3. Directors & UBOs', 'kyc_sec4': '4. AML / CFT Compliance', 'kyc_sec5': '5. Corporate Documents',
        'reg_name': 'Registered Company Name', 'reg_no': 'Registration No.', 'tax_id': 'Tax ID / VAT', 'website': 'Website', 'industry': 'Industry / Activity',
        'reg_addr': 'Registered Address', 'op_addr': 'Operational Address',
        'bank_name': 'Bank Name', 'bank_iban': 'IBAN / Account No.', 'bank_swift': 'SWIFT / BIC', 'bank_addr': 'Bank Branch Address', 'corr_bank': 'Correspondent Bank',
        'turnover': 'Expected Annual Volume (USD)', 'sof': 'Source of Funds / Wealth',
        'dir_title': 'Directors / Managers', 'ubo_title': 'Ultimate Beneficial Owners (>25%)',
        'add_dir': '+ Add Director', 'add_ubo': '+ Add UBO', 'dir_name': 'Full Legal Name', 'dir_pass': 'Passport Number', 'dir_nat': 'Nationality',
        'pep': 'Any owner/director is a Politically Exposed Person (PEP)?',
        'sanctions': 'Subject to any UN/OFAC international sanctions?',
        'litigation': 'Involved in any AML/CFT litigation?',
        'dual_use': 'Trades in Dual-Use goods or military equipment?',
        'up_license': 'Trade License(s)', 'up_pass': 'Passports (Directors & UBOs)', 'up_inc': 'Cert. of Incorporation / MoA', 'upload_multi': 'You can select multiple files per category',
        'decl_title': 'Declaration & Consent',
        'consent': 'I declare the information is true and accurate, and consent to secure storage and processing.',
        'btn_submit': 'Submit Securely', 'update_req': 'Action Required: KYC Update', 'update_req_desc': 'Your documentation has expired or requires renewal.',
        // Products (my goods)
        'goods_title': 'My Products', 'goods_desc': 'Add products with full specifications. Admin will review and publish to the catalog.',
        'th_prod_name': 'Product', 'th_prod_price': 'Price', 'th_prod_specs': 'Specifications', 'th_prod_status': 'Status', 'th_prod_actions': 'Actions',
        'btn_new_product': '+ Add Product', 'btn_edit': 'Edit', 'no_products': 'No products submitted yet.',
        'ptab_general': 'General Info', 'ptab_commercial': 'Pricing & Terms', 'ptab_specs': 'Specs & Logistics', 'ptab_packaging': 'Packaging & Stock',
        'prod_modal_title': 'Product Details',
        // Profile
        'profile_title': 'Profile Settings', 'profile_desc': 'Request updates to your contact details. Admin approval is required for changes to apply.',
        'profile_email': 'Email', 'profile_phone': 'Phone', 'profile_person': 'Contact Person', 'profile_street': 'Street & No.', 'profile_city': 'City', 'profile_country': 'Country', 'profile_note': 'Note for admin (optional)',
        'btn_save_profile': 'Send for approval',
        'profile_history': 'Your Change Requests', 'no_profile_requests': 'No pending change requests.',
        // OTP
        'otp_title': 'Secure Portal Access', 'otp_desc': 'A one-time code has been sent to your email.',
        'enter_code': 'Enter 6-digit Code', 'verify_btn': 'Verify & Login', 'otp_sent': 'Code sent. Please check your email.', 'requesting': 'Requesting OTP…',
        'uploading': 'Encrypting & uploading…',
        // Messages / errors
        'msg_product_saved': 'Product submitted for approval.',
        'msg_rfq_sent': 'RFQ submitted successfully.',
        'msg_profile_sent': 'Change request sent to administrator.',
        'msg_kyc_saved': 'KYC data securely stored.',
        'msg_download_logged': 'Download logged.',
        'err_generic': 'Something went wrong. Please try again.',
        'err_network': 'Network error. Check your connection.',
        'err_bad_otp': 'Invalid or expired code.',
        'err_product_required': 'Product name and price are required.',
        'err_rfq_required': 'Product and quantity are required.',
        'err_invalid_email': 'Please enter a valid email address.',
        'err_no_changes': 'Please enter at least one field to change.',
        'err_doc_not_found': 'Document not found.',
        'err_doc_forbidden': 'You are not authorized for this document.',
        'err_access_denied': 'Access denied.',
        // New — Financial & tracking widgets
        'fin_summary': 'Financial Summary', 'fin_total_spend': 'Total Business Volume', 'fin_open_offers_value': 'Open Offers Value',
        'fin_completed_deals': 'Completed Deals', 'fin_recent_downloads': 'Documents Downloaded',
        'track_title': 'Shipment Tracking', 'track_stage_negotiation': 'In Negotiation', 'track_stage_signed': 'Contract Signed',
        'track_stage_payment': 'Payment Processing', 'track_stage_shipped': 'Shipped', 'track_stage_delivered': 'Delivered',
        'notif_title': 'Notifications', 'notif_empty': 'No notifications', 'notif_mark_read': 'Mark all as read',
        'search_placeholder': 'Search…', 'filter_all': 'All', 'filter_pending': 'Pending', 'filter_accepted': 'Accepted', 'filter_declined': 'Declined',
        'download_all': 'Download all', 'export_history': 'Export history (CSV)',
        // KYC new fields
        'kyc_contact_phone': 'Contact Phone', 'kyc_city': 'City', 'kyc_country': 'Country', 'kyc_zip': 'ZIP / Postal Code'
    }
};

// Portal is English-only; keep the helper signature stable so existing
// render code (t('key')) works without changes.
const currentLang = 'en';
function t(key) { return (dict.en && dict.en[key]) || key; }
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function updateStaticText() {
    const T = dict.en;
    // Loading / header
    setText('lbl-loading', T.loading); setText('lbl-b2b', T.b2b); setText('lbl-welcome', T.welcome); setText('lbl-logout', T.logout);
    // Tabs
    setText('lbl-tab-dashboard', T.dashboard); setText('lbl-tab-shipments', T.shipments); setText('lbl-tab-offers', T.offers);
    setText('lbl-tab-rfq', T.rfq); setText('lbl-tab-docs', T.documents); setText('lbl-tab-goods', T.goods);
    setText('lbl-tab-kyc', T.kyc_tab); setText('lbl-tab-profile', T.profile);
    // Dashboard
    setText('lbl-stat-shipments', T.stat_shipments); setText('lbl-stat-offers', T.stat_offers); setText('lbl-stat-rfqs', T.stat_rfqs); setText('lbl-stat-kyc', T.stat_kyc);
    setText('lbl-recent-offers', T.recent_offers); setText('lbl-recent-docs', T.recent_docs);
    setText('lbl-view-all-offers', T.view_all_offers); setText('lbl-view-all-docs', T.view_all_docs);
    // Documents
    setText('lbl-docs-title', T.docs_title); setText('lbl-docs-desc', T.docs_desc);
    setText('th-doc-date', T.th_doc_date); setText('th-doc-type', T.th_doc_type); setText('th-doc-name', T.th_doc_name); setText('th-doc-action', T.th_doc_action);
    // RFQ
    setText('lbl-rfq-main-title', T.rfq_main_title); setText('lbl-rfq-main-desc', T.rfq_main_desc); setText('btn-new-rfq', T.btn_new_rfq);
    setText('lbl-rfq-modal-title', T.rfq_modal_title); setText('lbl-rfq-prod', T.rfq_prod); setText('lbl-rfq-qty', T.rfq_qty); setText('lbl-rfq-price', T.rfq_price); setText('lbl-rfq-notes', T.rfq_notes);
    setText('btn-rfq-send', T.btn_rfq_send); setText('btn-rfq-cancel', T.btn_rfq_cancel);
    // KYC
    setText('lbl-kyc-title', T.kyc_title); setText('lbl-kyc-desc', T.kyc_desc);
    setText('lbl-kyc-sec1', T.kyc_sec1); setText('lbl-kyc-sec2', T.kyc_sec2); setText('lbl-kyc-sec3', T.kyc_sec3); setText('lbl-kyc-sec4', T.kyc_sec4); setText('lbl-kyc-sec5', T.kyc_sec5);
    setText('lbl-reg-name', T.reg_name); setText('lbl-reg-no', T.reg_no); setText('lbl-tax-id', T.tax_id); setText('lbl-website', T.website); setText('lbl-industry', T.industry);
    setText('lbl-reg-addr', T.reg_addr); setText('lbl-op-addr', T.op_addr);
    setText('lbl-bank-name', T.bank_name); setText('lbl-bank-iban', T.bank_iban); setText('lbl-bank-swift', T.bank_swift); setText('lbl-bank-addr', T.bank_addr); setText('lbl-corr-bank', T.corr_bank);
    setText('lbl-turnover', T.turnover); setText('lbl-sof', T.sof); setText('lbl-dir-title', T.dir_title); setText('lbl-ubo-title', T.ubo_title);
    setText('btn-add-dir', T.add_dir); setText('btn-add-ubo', T.add_ubo);
    setText('lbl-pep', T.pep); setText('lbl-sanctions', T.sanctions); setText('lbl-litigation', T.litigation); setText('lbl-dualuse', T.dual_use);
    setText('lbl-up-license', T.up_license); setText('lbl-up-pass', T.up_pass); setText('lbl-up-inc', T.up_inc); setText('lbl-upload-multi', T.upload_multi);
    setText('lbl-decl-title', T.decl_title); setText('lbl-consent', T.consent); setText('btn-kyc-submit', T.btn_submit);
    setText('lbl-update-req', T.update_req); setText('lbl-update-req-desc', T.update_req_desc);
    // Products
    setText('lbl-goods-title', T.goods_title); setText('lbl-goods-desc', T.goods_desc);
    setText('th-prod-name', T.th_prod_name); setText('th-prod-price', T.th_prod_price); setText('th-prod-specs', T.th_prod_specs); setText('th-prod-status', T.th_prod_status); setText('th-prod-actions', T.th_prod_actions);
    setText('btn-new-product', T.btn_new_product);
    setText('lbl-ptab-general', T.ptab_general); setText('lbl-ptab-commercial', T.ptab_commercial); setText('lbl-ptab-specs', T.ptab_specs); setText('lbl-ptab-packaging', T.ptab_packaging);
    setText('product-modal-title', T.prod_modal_title);
    // Profile
    setText('lbl-profile-title', T.profile_title); setText('lbl-profile-desc', T.profile_desc);
    setText('lbl-profile-email', T.profile_email); setText('lbl-profile-phone', T.profile_phone); setText('lbl-profile-person', T.profile_person);
    setText('lbl-profile-street', T.profile_street); setText('lbl-profile-city', T.profile_city); setText('lbl-profile-country', T.profile_country);
    setText('lbl-profile-note', T.profile_note); setText('btn-save-profile', T.btn_save_profile);
    setText('lbl-profile-history', T.profile_history);
    // KYC new fields
    setText('lbl-kyc-phone', T.kyc_contact_phone); setText('lbl-kyc-city', T.kyc_city); setText('lbl-kyc-country', T.kyc_country); setText('lbl-kyc-zip', T.kyc_zip);
    // OTP
    setText('lbl-otp-title', T.otp_title); setText('lbl-otp-desc', T.otp_desc); setText('lbl-enter-code', T.enter_code); setText('btn-verify-otp', T.verify_btn);
    setText('lbl-uploading-docs', T.uploading);
}
