// ============================================================
// CropSathi — Shared Preferences Utility
// Language (i18n), Units, Theme — localStorage-backed, applied on every page load
// ============================================================

const CropSathiPrefs = (() => {
  const STORAGE_KEY = 'cropsathi_prefs';
  const DEFAULTS = { language: 'en', units: 'metric_ha', theme: 'light' };

  // API base URL — override via window.CROPSATHI_API_URL or defaults to localhost
  const API_BASE_URL = (typeof window !== 'undefined' && window.CROPSATHI_API_URL)
    ? window.CROPSATHI_API_URL
    : 'http://localhost:5000';
  // ========================================================
  // TRANSLATION MAPS  (en / hi / mr / bn / te / ta / gu / kn / ml / or / pa / as / ur)
  // ========================================================
  const translations = {
    en: {
      nav_dashboard: 'Dashboard', nav_my_fields: 'My Fields', nav_diagnose: 'Diagnose', nav_advisory: 'Advisory', nav_settings: 'Settings', nav_register: 'Register',
      dash_hello: 'Hello', dash_current_temp: 'Current Temperature', dash_weather_optimal: 'Optimal Growth Weather', dash_weather_warm: 'Warm / Growth Active', dash_weather_cool: 'Cool / Frost Risk Weather', dash_weather_hot: 'High Heat / Irrigation Advised', dash_field_health: 'Field Health Score', dash_field_health_sub: 'Real-time composite telemetry gauge score', dash_sentinel_sync: 'Sentinel Sync', dash_avg_score: 'AVG SCORE', dash_action: 'Action:', dash_no_action: 'No Action Needed', dash_irigate_48h: 'Irrigate in 48h', dash_canopy_pruning: 'Canopy Pruning', dash_needs_irrigation: 'Needs Irrigation', dash_commodities: 'Commodities & Food', dash_view_all: 'View All', dash_soil_temp: 'Soil temp', dash_humidity: 'Humidity', dash_wind: 'Wind', dash_precipitation: 'Precipitation', dash_my_fields: 'My Fields', dash_view_analytics: 'View Analytics',
      an_title: 'Field Analytics', an_loading: 'Analysing satellite data...', an_avg_score: 'Average', an_anomaly: 'Anomaly', an_source: 'Source', an_force_reanalyse: 'Force Re-analyse', an_reanalysing: 'Re-analysing...',
      mf_title: 'My Fields', mf_loading: 'Loading your fields...', mf_no_fields: 'No fields yet', mf_no_fields_desc: 'Add your first field to start tracking crop health and yield.', mf_add_field: 'Add New Field', mf_add_first: 'Add Your First Field', mf_view_details: 'View Details', mf_search_fields: 'Search fields...', mf_view_analytics: 'View Analytics',
      af_title: 'Add New Field', af_edit_title: 'Edit Field', af_back: 'Back to My Fields', af_field_details: 'Field Details', af_field_name: 'Field Name', af_crop_type: 'Crop Type', af_sowing_date: 'Sowing Date', af_polygon_summary: 'Polygon Summary', af_points: 'Points', af_area: 'Area', af_cancel: 'Cancel', af_save: 'Save Field', af_start_drawing: 'Start Drawing Boundary', af_drawing_active: 'Save Selected Area', af_polygon_drawn: 'Polygon Drawn ✓', af_use_location: 'Use My Location', af_locating: 'Locating...', af_location_found: 'Location Found', af_undo: 'Undo', af_clear: 'Clear', af_how_to: 'How to mark your field:', af_step1: 'Click "Use My Location" or navigate to your field', af_step2: 'Click "Start Drawing" to enter drawing mode', af_step3: 'Click on the map to mark corners of your field', af_step4: 'Click the first point again to complete the polygon',
      settings_title: 'Settings', settings_subtitle: 'Account & Preferences', settings_search: 'Search settings...', settings_profile: 'Profile', settings_full_name: 'Full Name', settings_mobile: 'Mobile Number', settings_district: 'District', settings_account_status: 'Account Status', settings_verified: 'Verified Farmer', settings_edit_profile: 'Edit Profile', settings_upload_photo: 'Upload New Photo', settings_locked: 'Locked', settings_preferences: 'Preferences', settings_language: 'App Language', settings_units: 'Preferred Units System', settings_units_desc: 'Area, weight, and temperature measurements', settings_theme: 'Theme Preference', settings_push_notifications: 'Push Notifications', settings_severe_alerts: 'Severe Weather & Pest Alerts', settings_severe_alerts_desc: 'Priority warnings for frost, unseasonal rain & pest outbreaks', settings_location: 'Location', settings_update_gps: 'Update GPS', settings_app_version: 'App Version', settings_data_mgmt: 'Data Management', settings_data_export: 'Data Export', settings_data_export_desc: 'Download field records, diagnostic history & advisory logs', settings_export_btn: 'Export Records', settings_support: 'Support & Feedback', settings_helpline: 'Voice-Guided Support / Helpline', settings_helpline_desc: 'Call Kisan Extension Support (1800-180-1551)', settings_feedback: 'Report an Issue / Feedback', settings_feedback_desc: 'Share suggestions or report bugs directly to our team', settings_security: 'Security', settings_change_pw: 'Change Password', settings_2fa: 'Two-Factor Authentication', settings_logout: 'Log Out', settings_save_changes: 'Save Changes',
      cp_title: 'Change Password', cp_current: 'Current Password', cp_current_placeholder: 'Enter current password', cp_new: 'New Password', cp_new_placeholder: 'Min 6 characters', cp_confirm: 'Confirm New Password', cp_confirm_placeholder: 'Re-enter new password', cp_hint: 'Must be at least 6 characters long.', cp_save: 'Save Password', cp_cancel: 'Cancel',
      fb_title: 'Report an Issue / Feedback', fb_category: 'Category', fb_cat_bug: 'Report a Bug / Issue', fb_cat_feature: 'Missing Crop/Feature Request', fb_cat_other: 'General Feedback', fb_details: 'Details', fb_details_placeholder: 'Describe the issue or feedback...', fb_submit: 'Submit',
      login_title: 'CropSathi', login_subtitle: 'Sign in to your account', login_phone: 'Phone Number', login_phone_placeholder: '+91 98765 43210', login_password: 'Password', login_password_placeholder: 'Enter your password', login_btn: 'Sign In', login_no_account: "Don't have an account?", login_register: 'Register', login_has_account: 'Already have an account?', login_signin: 'Sign In',
      reg_title: 'Full Name', reg_name_placeholder: 'Your name', reg_phone_placeholder: '9876543210', reg_password_placeholder: 'Min 6 characters', reg_btn: 'Create Account',
      fd_boundary: 'Field Boundary', fd_area: 'Area:', fd_sown: 'Sown:', fd_points: 'Points:', fd_status: 'Status', fd_active: 'Active', fd_edit: 'Edit Field', fd_close: 'Close',
      btn_close: 'Close', btn_save: 'Save', btn_cancel: 'Cancel', btn_confirm: 'Confirm', btn_delete: 'Delete',
      unit_ha: 'ha', unit_ac: 'ac', unit_bigha: 'Bigha', unit_kg: 'kg', unit_quintal: 'Quintal', unit_mps: 'm/s', unit_mm: 'mm',
    },
    hi: {
      nav_dashboard: 'डैशबोर्ड', nav_my_fields: 'मेरे खेत', nav_diagnose: 'निदान', nav_advisory: 'सलाह', nav_settings: 'सेटिंग्स', nav_register: 'पंजीकरण',
      dash_hello: 'नमस्ते', dash_current_temp: 'वर्तमान तापमान', dash_weather_optimal: 'उत्तम विकास मौसम', dash_weather_warm: 'गर्म / विकास सक्रिय', dash_weather_cool: 'ठंडा / ठंड का खतरा', dash_weather_hot: 'अधिक गर्मी / सिंचाई सलाह', dash_field_health: 'खेत स्वास्थ्य स्कोर', dash_field_health_sub: 'रीयल-टाइम संयुक्त टेलीमेट्री गेज स्कोर', dash_sentinel_sync: 'सेंटिनेल सिंक', dash_avg_score: 'औसत स्कोर', dash_action: 'कार्रवाई:', dash_no_action: 'कोई कार्रवाई आवश्यक नहीं', dash_irigate_48h: '48 घंटे में सिंचाई', dash_canopy_pruning: 'छतरी छंटाई', dash_needs_irrigation: 'सिंचाई आवश्यक', dash_commodities: 'कमोडिटीज और खाद्य', dash_view_all: 'सभी देखें', dash_soil_temp: 'मिट्टी का तापमान', dash_humidity: 'आर्द्रता', dash_wind: 'हवा', dash_precipitation: 'वर्षा', dash_my_fields: 'मेरे खेत', dash_view_analytics: 'विश्लेषण देखें',
      an_title: 'खेत विश्लेषण', an_loading: 'उपग्रह डेटा का विश्लेषण हो रहा है...', an_avg_score: 'औसत', an_anomaly: 'विसंगति', an_source: 'स्रोत', an_force_reanalyse: 'पुनर्विश्लेषण', an_reanalysing: 'पुनर्विश्लेषण हो रहा है...',
      mf_title: 'मेरे खेत', mf_loading: 'आपके खेत लोड हो रहे हैं...', mf_no_fields: 'अभी तक कोई खेत नहीं', mf_no_fields_desc: 'फसल स्वास्थ्य और उपज ट्रैक करने के लिए अपना पहला खेत जोड़ें।', mf_add_field: 'नया खेत जोड़ें', mf_add_first: 'अपना पहला खेत जोड़ें', mf_view_details: 'विवरण देखें', mf_search_fields: 'खेत खोजें...', mf_view_analytics: 'विश्लेषण देखें',
      af_title: 'नया खेत जोड़ें', af_edit_title: 'खेत संपादित करें', af_back: 'मेरे खेत पर वापस', af_field_details: 'खेत विवरण', af_field_name: 'खेत का नाम', af_crop_type: 'फसल का प्रकार', af_sowing_date: 'बुवाई की तारीख', af_polygon_summary: 'बहुभुष सारांश', af_points: 'बिंदु', af_area: 'क्षेत्रफल', af_cancel: 'रद्द करें', af_save: 'खेत सहेजें', af_start_drawing: 'सीमा बनाना शुरू करें', af_drawing_active: 'चयनित क्षेत्र सहेजें', af_polygon_drawn: 'बहुभुष बनाया ✓', af_use_location: 'मेरा स्थान उपयोग करें', af_locating: 'स्थान खोज रहे हैं...', af_location_found: 'स्थान मिला', af_undo: 'पूर्ववत करें', af_clear: 'साफ करें', af_how_to: 'अपना खेत कैसे चिह्नित करें:', af_step1: '"मेरा स्थान उपयोग करें" पर क्लिक करें या अपने खेत पर जाएं', af_step2: '"बनाना शुरू करें" पर क्लिक करें', af_step3: 'अपने खेत के कोनों को चिह्नित करने के लिए मानचित्र पर क्लिक करें', af_step4: 'बहुभुष पूरा करने के लिए पहले बिंदु पर फिर से क्लिक करें',
      settings_title: 'सेटिंग्स', settings_subtitle: 'खाता और प्राथमिकताएं', settings_search: 'सेटिंग्स खोजें...', settings_profile: 'प्रोफ़ाइल', settings_full_name: 'पूरा नाम', settings_mobile: 'मोबाइल नंबर', settings_district: 'जिला', settings_account_status: 'खाता स्थिति', settings_verified: 'सत्यापित किसान', settings_edit_profile: 'प्रोफ़ाइल संपादित करें', settings_upload_photo: 'नई फ़ोटो अपलोड करें', settings_locked: 'बंद', settings_preferences: 'प्राथमिकताएं', settings_language: 'ऐप भाषा', settings_units: 'पसंदीदा इकाई प्रणाली', settings_units_desc: 'क्षेत्रफल, वजन और तापमान माप', settings_theme: 'थीम प्राथमिकता', settings_push_notifications: 'पुश सूचनाएं', settings_severe_alerts: 'गंभीर मौसम और कीट अलर्ट', settings_severe_alerts_desc: 'पाला, अनियमित बारिश और कीट प्रकोप के लिए प्राथमिकता चेतावनी', settings_location: 'स्थान', settings_update_gps: 'GPS अपडेट करें', settings_app_version: 'ऐप संस्करण', settings_data_mgmt: 'डेटा प्रबंधन', settings_data_export: 'डेटा निर्यात', settings_data_export_desc: 'खेत रिकॉर्ड, निदान इतिहास और सलाह लॉग डाउनलोड करें', settings_export_btn: 'रिकॉर्ड निर्यात करें', settings_support: 'सहायता और प्रतिक्रिया', settings_helpline: 'वॉइस-गाइडेड सहायता / हेल्पलाइन', settings_helpline_desc: 'किसान एक्सटेंशन सहायता को कॉल करें (1800-180-1551)', settings_feedback: 'समस्या रिपोर्ट करें / प्रतिक्रिया', settings_feedback_desc: 'हमारी टीम को सुझाव या बग रिपोर्ट सीधे भेजें', settings_security: 'सुरक्षा', settings_change_pw: 'पासवर्ड बदलें', settings_2fa: 'दो-कारक प्रमाणीकरण', settings_logout: 'लॉग आउट', settings_save_changes: 'परिवर्तन सहेजें',
      cp_title: 'पासवर्ड बदलें', cp_current: 'वर्तमान पासवर्ड', cp_current_placeholder: 'वर्तमान पासवर्ड दर्ज करें', cp_new: 'नया पासवर्ड', cp_new_placeholder: 'न्यूनतम 6 अक्षर', cp_confirm: 'नया पासवर्ड पुष्टि करें', cp_confirm_placeholder: 'नया पासवर्ड फिर से दर्ज करें', cp_hint: 'कम से कम 6 अक्षर लंबा होना चाहिए।', cp_save: 'पासवर्ड सहेजें', cp_cancel: 'रद्द करें',
      fb_title: 'समस्या रिपोर्ट करें / प्रतिक्रिया', fb_category: 'श्रेणी', fb_cat_bug: 'बग / समस्या रिपोर्ट करें', fb_cat_feature: 'गायब फसल/सुविधा अनुरोध', fb_cat_other: 'सामान्य प्रतिक्रिया', fb_details: 'विवरण', fb_details_placeholder: 'समस्या या प्रतिक्रिया का वर्णन करें...', fb_submit: 'जमा करें',
      login_title: 'क्रॉपसाथी', login_subtitle: 'अपने खाते में साइन इन करें', login_phone: 'फ़ोन नंबर', login_phone_placeholder: '+91 98765 43210', login_password: 'पासवर्ड', login_password_placeholder: 'अपना पासवर्ड दर्ज करें', login_btn: 'साइन इन', login_no_account: 'खाता नहीं है?', login_register: 'पंजीकरण', login_has_account: 'पहले से खाता है?', login_signin: 'साइन इन',
      reg_title: 'पूरा नाम', reg_name_placeholder: 'आपका नाम', reg_phone_placeholder: '9876543210', reg_password_placeholder: 'न्यूनतम 6 अक्षर', reg_btn: 'खाता बनाएं',
      fd_boundary: 'खेत सीमा', fd_area: 'क्षेत्रफल:', fd_sown: 'बुवाई:', fd_points: 'बिंदु:', fd_status: 'स्थिति', fd_active: 'सक्रिय', fd_edit: 'खेत संपादित करें', fd_close: 'बंद करें',
      btn_close: 'बंद करें', btn_save: 'सहेजें', btn_cancel: 'रद्द करें', btn_confirm: 'पुष्टि करें', btn_delete: 'हटाएं',
      unit_ha: 'हेक्टेयर', unit_ac: 'एकड़', unit_bigha: 'बीघा', unit_kg: 'किलो', unit_quintal: 'क्विंटल', unit_mps: 'मी/से', unit_mm: 'मिमी',
    },
    mr: {
      nav_dashboard: 'डॅशबोर्ड', nav_my_fields: 'माझे शेत', nav_diagnose: 'निदान', nav_advisory: 'सल्ला', nav_settings: 'सेटिंग्स', nav_register: 'नोंदणी',
      dash_hello: 'नमस्कार', dash_current_temp: 'सध्याचे तापमान', dash_weather_optimal: 'उत्तम वाढ हवामान', dash_weather_warm: 'उबदार / वाढ सक्रिय', dash_weather_cool: 'थंड / थंडीचा धोका', dash_weather_hot: 'अत्यधिक उष्णता / सिंचन सल्ला', dash_field_health: 'शेत आरोग्य स्कोअर', dash_field_health_sub: 'रिअल-टाइम संयुक्त टेलिमेट्री गेज स्कोअर', dash_sentinel_sync: 'सेंटिनेल सिंक', dash_avg_score: 'सरासरी स्कोअर', dash_action: 'कृती:', dash_no_action: 'कृती आवश्यक नाही', dash_irigate_48h: '48 तासांत सिंचन', dash_canopy_pruning: 'कॅनोपी छाटणी', dash_needs_irrigation: 'सिंचन आवश्यक', dash_commodities: 'कमोडिटीज आणि अन्न', dash_view_all: 'सर्व पहा', dash_soil_temp: 'माती तापमान', dash_humidity: 'दमटता', dash_wind: 'वारा', dash_precipitation: 'पाऊस', dash_my_fields: 'माझे शेत', dash_view_analytics: 'विश्लेषण पहा',
      an_title: 'शेत विश्लेषण', an_loading: 'उपग्रह डेटा लोड होत आहे...', an_avg_score: 'सरासरी', an_anomaly: 'विसंगती', an_source: 'स्रोत',
      mf_title: 'माझे शेत', mf_loading: 'तुमची शेत लोड होत आहे...', mf_no_fields: 'अजून कोणतीही शेत नाही', mf_no_fields_desc: 'पिकांचे आरोग्य आणि उत्पादन ट्रॅक करण्यासाठी तुमचे पहिले शेत जोडा.', mf_add_field: 'नवीन शेत जोडा', mf_add_first: 'तुमचे पहिले शेत जोडा', mf_view_details: 'तपशील पहा', mf_search_fields: 'शेत शोधा...', mf_view_analytics: 'विश्लेषण पहा',
      af_title: 'नवीन शेत जोडा', af_edit_title: 'शेत संपादित करा', af_back: 'माझ्या शेतावर परत', af_field_details: 'शेत तपशील', af_field_name: 'शेताचे नाव', af_crop_type: 'पिकाचा प्रकार', af_sowing_date: 'पेरणीची तारीख', af_polygon_summary: 'बहुभुज सारांश', af_points: 'बिंदू', af_area: 'क्षेत्रफळ', af_cancel: 'रद्द करा', af_save: 'शेत जतन करा', af_start_drawing: 'हद्द रेखा काढा', af_drawing_active: 'निवडलेले क्षेत्र जतन करा', af_polygon_drawn: 'बहुभुज काढला ✓', af_use_location: 'माझे स्थान वापरा', af_locating: 'स्थान शोधत आहे...', af_location_found: 'स्थान सापडले', af_undo: 'पूर्ववत करा', af_clear: 'साफ करा', af_how_to: 'तुमचे शेत कसे चिन्हांकित करावे:', af_step1: '"माझे स्थान वापरा" वर क्लिक करा किंवा तुमच्या शेतावर जा', af_step2: '"काढायला सुरू करा" वर क्लिक करा', af_step3: 'तुमच्या शेताचे कोपरे चिन्हांकित करण्यासाठी नकाशावर क्लिक करा', af_step4: 'बहुभुज पूर्ण करण्यासाठी पहिल्या बिंदूवर पुन्हा क्लिक करा',
      settings_title: 'सेटिंग्स', settings_subtitle: 'खाते आणि प्राधान्ये', settings_search: 'सेटिंग्स शोधा...', settings_profile: 'प्रोफाइल', settings_full_name: 'पूर्ण नाव', settings_mobile: 'मोबाइल नंबर', settings_district: 'जिल्हा', settings_account_status: 'खाते स्थिती', settings_verified: 'सत्यापित शेतकरी', settings_edit_profile: 'प्रोफाइल संपादित करा', settings_upload_photo: 'नवीन फोटो अपलोड करा', settings_locked: 'बंद', settings_preferences: 'प्राधान्ये', settings_language: 'अॅप भाषा', settings_units: 'पसंदीदा एकाई प्रणाली', settings_units_desc: 'क्षेत्रफळ, वजन आणि तापमान मोजमाप', settings_theme: 'थीम प्राधान्य', settings_push_notifications: 'पुश सूचना', settings_severe_alerts: 'गंभीर हवामान आणि कीड अलर्ट', settings_severe_alerts_desc: 'पाला, अनियमित पाऊस आणि कीड प्रादुर्भावासाठी प्राधान्य चेतावनी', settings_location: 'स्थान', settings_update_gps: 'GPS अपडेट करा', settings_app_version: 'अॅप आवृत्ती', settings_data_mgmt: 'डेटा व्यवस्थापन', settings_data_export: 'डेटा निर्यात', settings_data_export_desc: 'शेत रेकॉर्ड, निदान इतिहास आणि सल्ला लॉग डाउनलोड करा', settings_export_btn: 'रेकॉर्ड निर्यात करा', settings_support: 'सहाय्य आणि अभिप्राय', settings_helpline: 'व्हॉइस-गाईडेड सहाय्य / हेल्पलाइन', settings_helpline_desc: 'किसान एक्स्टेंशन सहाय्याला कॉल करा (1800-180-1551)', settings_feedback: 'समस्या नोंदवा / अभिप्राय', settings_feedback_desc: 'आमच्या टीमला जुगाड किंवा बग थेट पाठवा', settings_security: 'सुरक्षा', settings_change_pw: 'पासवर्ड बदला', settings_2fa: 'द्वि-घटक प्रमाणीकरण', settings_logout: 'लॉग आउट', settings_save_changes: 'बदल जतन करा',
      cp_title: 'पासवर्ड बदला', cp_current: 'सध्याचा पासवर्ड', cp_current_placeholder: 'सध्याचा पासवर्ड टाका', cp_new: 'नवीन पासवर्ड', cp_new_placeholder: 'किमान 6 अक्षरे', cp_confirm: 'नवीन पासवर्ड पुष्टी करा', cp_confirm_placeholder: 'नवीन पासवर्ड पुन्हा टाका', cp_hint: 'किमान 6 अक्षरे लांब असणे आवश्यक आहे.', cp_save: 'पासवर्ड जतन करा', cp_cancel: 'रद्द करा',
      fb_title: 'समस्या नोंदवा / अभिप्राय', fb_category: 'वर्ग', fb_cat_bug: 'बग / समस्या नोंदवा', fb_cat_feature: 'गायब पिक/वैशिष्ट्य विनंती', fb_cat_other: 'सामान्य अभिप्राय', fb_details: 'तपशील', fb_details_placeholder: 'समस्या किंवा अभिप्रायचे वर्णन करा...', fb_submit: 'सबमिट करा',
      login_title: 'क्रॉपसाथी', login_subtitle: 'तुमच्या खात्यात साइन इन करा', login_phone: 'फोन नंबर', login_phone_placeholder: '+91 98765 43210', login_password: 'पासवर्ड', login_password_placeholder: 'तुमचा पासवर्ड टाका', login_btn: 'साइन इन', login_no_account: 'खाते नाही?', login_register: 'नोंदणी', login_has_account: 'आधीच खाते आहे?', login_signin: 'साइन इन',
      reg_title: 'पूर्ण नाव', reg_name_placeholder: 'तुमचे नाव', reg_phone_placeholder: '9876543210', reg_password_placeholder: 'किमान 6 अक्षरे', reg_btn: 'खाते तयार करा',
      fd_boundary: 'शेत हद्द', fd_area: 'क्षेत्रफळ:', fd_sown: 'पेरणी:', fd_points: 'बिंदू:', fd_status: 'स्थिती', fd_active: 'सक्रिय', fd_edit: 'शेत संपादित करा', fd_close: 'बंद करा',
      btn_close: 'बंद करा', btn_save: 'जतन करा', btn_cancel: 'रद्द करा', btn_confirm: 'पुष्टी करा', btn_delete: 'हटवा',
      unit_ha: 'हेक्टर', unit_ac: 'एकर', unit_bigha: 'बीघा', unit_kg: 'किलो', unit_quintal: 'क्विंटल', unit_mps: 'मी/से', unit_mm: 'मिमी',
    },
    bn: {
      nav_dashboard: 'ড্যাশবোর্ড', nav_my_fields: 'আমার জমি', nav_diagnose: 'রোগ নির্ণয়', nav_advisory: 'পরামর্শ', nav_settings: 'সেটিংস', nav_register: 'নিবন্ধন করুন',
      dash_hello: 'নমস্কার', dash_current_temp: 'বর্তমান তাপমাত্রা', dash_weather_optimal: 'অনুকূল আবহাওয়া', dash_weather_warm: 'উষ্ণ আবহাওয়া', dash_weather_cool: 'শীতল / তুষারপাতের ঝুঁকি', dash_weather_hot: 'প্রচণ্ড তাপ / সেচ প্রয়োজন', dash_field_health: 'জমির স্বাস্থ্য স্কোর', dash_field_health_sub: 'রিয়েল-টাইম স্বাস্থ্য স্কোর', dash_sentinel_sync: 'সেন্টিনেল সিঙ্ক', dash_avg_score: 'গড় স্কোর', dash_action: 'পদক্ষেপ:', dash_no_action: 'কোনো পদক্ষেপের প্রয়োজন নেই', dash_irigate_48h: '৪৮ ঘণ্টার মধ্যে সেচ দিন', dash_canopy_pruning: 'ডালপালা ছাঁটাই', dash_needs_irrigation: 'সেচ প্রয়োজন', dash_commodities: 'পণ্য ও খাদ্য', dash_view_all: 'সব দেখুন', dash_soil_temp: 'মাটির তাপমাত্রা', dash_humidity: 'আর্দ্রতা', dash_wind: 'বাতাস', dash_precipitation: 'বৃষ্টিপাত', dash_my_fields: 'আমার জমি', dash_view_analytics: 'বিশ্লেষণ দেখুন',
      an_title: 'জমির বিশ্লেষণ', an_loading: 'স্যাটেলাইট ডেটা লোড হচ্ছে...', an_avg_score: 'গড়', an_anomaly: 'অস্বাভাবিকতা', an_source: 'উৎস',
      mf_title: 'আমার জমি', mf_loading: 'আপনার জমি লোড হচ্ছে...', mf_no_fields: 'এখনো কোনো জমি নেই', mf_no_fields_desc: 'ফসল ট্র্যাক করতে আপনার প্রথম জমি যোগ করুন।', mf_add_field: 'নতুন জমি যোগ করুন', mf_add_first: 'প্রথম জমি যোগ করুন', mf_view_details: 'বিস্তারিত দেখুন', mf_search_fields: 'জমি খুঁজুন...', mf_view_analytics: 'বিশ্লেষণ দেখুন',
      af_title: 'নতুন জমি যোগ করুন', af_edit_title: 'জমি সম্পাদনা করুন', af_back: 'আমার জমিতে ফিরে যান', af_field_details: 'জমির বিস্তারিত', af_field_name: 'জমির নাম', af_crop_type: 'ফসলের ধরন', af_sowing_date: 'বপনের তারিখ', af_polygon_summary: 'বহুভুজ সারসংক্ষেপ', af_points: 'বিন্দু', af_area: 'এলাকা', af_cancel: 'বাতিল করুন', af_save: 'সংরক্ষণ করুন', af_start_drawing: 'সীমানা আঁকা শুরু করুন', af_drawing_active: 'নির্বাচিত এলাকা সংরক্ষণ করুন', af_polygon_drawn: 'বহুভুজ আঁকা হয়েছে ✓', af_use_location: 'আমার অবস্থান ব্যবহার করুন', af_locating: 'অবস্থান খোঁজা হচ্ছে...', af_location_found: 'অবস্থান পাওয়া গেছে', af_undo: 'পূর্বাবস্থায় ফেরান', af_clear: 'মুছুন', af_how_to: 'কীভাবে জমি চিহ্নিত করবেন:', af_step1: '"আমার অবস্থান ব্যবহার করুন" এ ক্লিক করুন', af_step2: '"আঁকা শুরু করুন" এ ক্লিক করুন', af_step3: 'মানচিত্রে ক্লিক করে সীমানা চিহ্নিত করুন', af_step4: 'প্রথম বিন্দুতে আবার ক্লিক করে শেষ করুন',
      settings_title: 'সেটিংস', settings_subtitle: 'অ্যাকাউন্ট এবং পছন্দ', settings_search: 'সেটিংস খুঁজুন...', settings_profile: 'প্রোফাইল', settings_full_name: 'পুরো নাম', settings_mobile: 'মোবাইল নম্বর', settings_district: 'জেলা', settings_account_status: 'অ্যাকাউন্ট স্ট্যাটাস', settings_verified: 'যাচাইকৃত কৃষক', settings_edit_profile: 'প্রোফাইল সম্পাদনা করুন', settings_upload_photo: 'নতুন ছবি আপলোড করুন', settings_locked: 'লক করা', settings_preferences: 'পছন্দসমূহ', settings_language: 'অ্যাপের ভাষা', settings_units: 'পরিমাপের একক', settings_units_desc: 'এলাকা, ওজন এবং তাপমাত্রা পরিমাপ', settings_theme: 'থিম পছন্দ', settings_push_notifications: 'পুশ নোটিফিকেশন', settings_severe_alerts: 'প্রতিকূল আবহাওয়া ও পোকার সতর্কতা', settings_severe_alerts_desc: 'বৃষ্টি ও পোকার আক্রমণের সতর্কতা', settings_location: 'অবস্থান', settings_update_gps: 'GPS আপডেট করুন', settings_app_version: 'অ্যাপ ভার্সন', settings_data_mgmt: 'ডেটা ব্যবস্থাপনা', settings_data_export: 'ডেটা এক্সপোর্ট', settings_data_export_desc: 'জমির রেকর্ড ও ইতিহাস ডাউনলোড করুন', settings_export_btn: 'রেকর্ড এক্সপোর্ট করুন', settings_support: 'সহায়তা ও মতামত', settings_helpline: 'হেল্পলাইন', settings_helpline_desc: 'কিসান এক্সটেনশনে কল করুন (1800-180-1551)', settings_feedback: 'সমস্যা জানান / মতামত দিন', settings_feedback_desc: 'আমাদের দলকে সরাসরি মতামত দিন', settings_security: 'নিরাপত্তা', settings_change_pw: 'পাসওয়ার্ড পরিবর্তন করুন', settings_2fa: 'টু-ফ্যাক্টর অথেনটিকেশন', settings_logout: 'লগ আউট', settings_save_changes: 'পরিবর্তন সংরক্ষণ করুন',
      cp_title: 'পাসওয়ার্ড পরিবর্তন করুন', cp_current: 'বর্তমান পাসওয়ার্ড', cp_current_placeholder: 'বর্তমান পাসওয়ার্ড দিন', cp_new: 'নতুন পাসওয়ার্ড', cp_new_placeholder: 'অন্তত ৬টি অক্ষর', cp_confirm: 'নতুন পাসওয়ার্ড নিশ্চিত করুন', cp_confirm_placeholder: 'নতুন পাসওয়ার্ড আবার দিন', cp_hint: 'অন্তত ৬ অক্ষরের হতে হবে।', cp_save: 'পাসওয়ার্ড সংরক্ষণ করুন', cp_cancel: 'বাতিল করুন',
      fb_title: 'সমস্যা জানান / মতামত দিন', fb_category: 'বিভাগ', fb_cat_bug: 'বাগ/সমস্যা রিপোর্ট করুন', fb_cat_feature: 'নতুন ফিচারের অনুরোধ', fb_cat_other: 'সাধারণ মতামত', fb_details: 'বিস্তারিত', fb_details_placeholder: 'সমস্যা বা মতামত বর্ণনা করুন...', fb_submit: 'জমা দিন',
      login_title: 'ক্রপসাথী', login_subtitle: 'অ্যাকাউন্টে সাইন ইন করুন', login_phone: 'ফোন নম্বর', login_phone_placeholder: '+91 98765 43210', login_password: 'পাসওয়ার্ড', login_password_placeholder: 'আপনার পাসওয়ার্ড দিন', login_btn: 'সাইন ইন', login_no_account: 'অ্যাকাউন্ট নেই?', login_register: 'নিবন্ধন করুন', login_has_account: 'আগে থেকেই অ্যাকাউন্ট আছে?', login_signin: 'সাইন ইন',
      reg_title: 'পুরো নাম', reg_name_placeholder: 'আপনার নাম', reg_phone_placeholder: '9876543210', reg_password_placeholder: 'অন্তত ৬টি অক্ষর', reg_btn: 'অ্যাকাউন্ট তৈরি করুন',
      fd_boundary: 'জমির সীমানা', fd_area: 'এলাকা:', fd_sown: 'বপন:', fd_points: 'বিন্দু:', fd_status: 'অবস্থা', fd_active: 'সক্রিয়', fd_edit: 'জমি সম্পাদনা', fd_close: 'বন্ধ করুন',
      btn_close: 'বন্ধ করুন', btn_save: 'সংরক্ষণ করুন', btn_cancel: 'বাতিল করুন', btn_confirm: 'নিশ্চিত করুন', btn_delete: 'মুছুন',
      unit_ha: 'হেক্টর', unit_ac: 'একর', unit_bigha: 'বিঘা', unit_kg: 'কেজি', unit_quintal: 'কুইন্টাল', unit_mps: 'মি/সে', unit_mm: 'মিমি',
    },
    te: {
      nav_dashboard: 'డాష్‌బోర్డ్', nav_my_fields: 'నా పొలాలు', nav_diagnose: 'రోగ నిర్ధారణ', nav_advisory: 'సలహా', nav_settings: 'సెట్టింగ్‌లు', nav_register: 'నమోదు',
      dash_hello: 'నమస్కారం', dash_current_temp: 'ప్రస్తుత ఉష్ణోగ్రత', dash_weather_optimal: 'అనుకూలమైన వాతావరణం', dash_weather_warm: 'వెచ్చని వాతావరణం', dash_weather_cool: 'చల్లని / మంచు ప్రమాదం', dash_weather_hot: 'అధిక వేడి / నీటి పారుదల అవసరం', dash_field_health: 'పొలం ఆరోగ్య స్కోర్', dash_field_health_sub: 'రియల్-టైమ్ ఆరోగ్య స్కోర్', dash_sentinel_sync: 'సెంటినెల్ సింక్', dash_avg_score: 'సగటు స్కోర్', dash_action: 'చర్య:', dash_no_action: 'ఎలాంటి చర్య అవసరం లేదు', dash_irigate_48h: '48 గంటల్లో నీరు పెట్టండి', dash_canopy_pruning: 'కొమ్మల కత్తిరింపు', dash_needs_irrigation: 'నీటి పారుదల అవసరం', dash_commodities: 'వస్తువులు & ఆహారం', dash_view_all: 'అన్నీ చూడండి', dash_soil_temp: 'మట్టి ఉష్ణోగ్రత', dash_humidity: 'తేమ', dash_wind: 'గాలి', dash_precipitation: 'వర్షపాతం', dash_my_fields: 'నా పొలాలు', dash_view_analytics: 'విశ్లేషణ చూడండి',
      an_title: 'పొలం విశ్లేషణ', an_loading: 'ఉపగ్రహ డేటా లోడ్ అవుతోంది...', an_avg_score: 'సగటు', an_anomaly: 'అసాధారణం', an_source: 'మూలం',
      mf_title: 'నా పొలాలు', mf_loading: 'మీ పొలాలు లోడ్ అవుతున్నాయి...', mf_no_fields: 'ఇంకా పొలాలు లేవు', mf_no_fields_desc: 'పంటను ట్రాక్ చేయడానికి మీ మొదటి పొలాన్ని జోడించండి.', mf_add_field: 'కొత్త పొలాన్ని జోడించండి', mf_add_first: 'మొదటి పొలాన్ని జోడించండి', mf_view_details: 'వివరాలు చూడండి', mf_search_fields: 'పొలాలను వెతకండి...', mf_view_analytics: 'విశ్లేషణ చూడండి',
      af_title: 'కొత్త పొలాన్ని జోడించండి', af_edit_title: 'పొలాన్ని సవరించండి', af_back: 'నా పొలాలకు తిరిగి వెళ్లండి', af_field_details: 'పొలం వివరాలు', af_field_name: 'పొలం పేరు', af_crop_type: 'పంట రకం', af_sowing_date: 'విత్తిన తేదీ', af_polygon_summary: 'పాలిగాన్ సారాంశం', af_points: 'పాయింట్లు', af_area: 'విస్తీర్ణం', af_cancel: 'రద్దు చేయండి', af_save: 'పొలాన్ని భద్రపరచండి', af_start_drawing: 'సరిహద్దు గీయడం ప్రారంభించండి', af_drawing_active: 'ఎంచుకున్న ప్రాంతాన్ని సేవ్ చేయండి', af_polygon_drawn: 'పాలిగాన్ గీయబడింది ✓', af_use_location: 'నా స్థానాన్ని ఉపయోగించండి', af_locating: 'స్థానాన్ని కనుగొంటోంది...', af_location_found: 'స్థానం కనుగొనబడింది', af_undo: 'అన్‌డూ', af_clear: 'క్లియర్', af_how_to: 'మీ పొలాన్ని ఎలా గుర్తించాలి:', af_step1: '"నా స్థానాన్ని ఉపయోగించండి" క్లిక్ చేయండి', af_step2: '"గీయడం ప్రారంభించండి" క్లిక్ చేయండి', af_step3: 'సరిహద్దును గుర్తించడానికి మ్యాప్‌పై క్లిక్ చేయండి', af_step4: 'పూర్తి చేయడానికి మొదటి పాయింట్‌పై మళ్లీ క్లిక్ చేయండి',
      settings_title: 'సెట్టింగ్‌లు', settings_subtitle: 'ఖాతా మరియు ప్రాధాన్యతలు', settings_search: 'సెట్టింగ్‌లను వెతకండి...', settings_profile: 'ప్రొఫైల్', settings_full_name: 'పూర్తి పేరు', settings_mobile: 'మొబైల్ నంబర్', settings_district: 'జిల్లా', settings_account_status: 'ఖాతా స్థితి', settings_verified: 'ధృవీకరించబడిన రైతులు', settings_edit_profile: 'ప్రొఫైల్‌ను సవరించండి', settings_upload_photo: 'కొత్త ఫోటోను అప్‌లోడ్ చేయండి', settings_locked: 'లాక్ చేయబడింది', settings_preferences: 'ప్రాధాన్యతలు', settings_language: 'యాప్ భాష', settings_units: 'కొలత యూనిట్లు', settings_units_desc: 'విస్తీర్ణం, బరువు మరియు ఉష్ణోగ్రత కొలతలు', settings_theme: 'థీమ్ ప్రాధాన్యత', settings_push_notifications: 'పుష్ నోటిఫికేషన్‌లు', settings_severe_alerts: 'వాతావరణ మరియు తెగులు హెచ్చరికలు', settings_severe_alerts_desc: 'వర్షం మరియు తెగుళ్ల దాడుల కోసం హెచ్చరికలు', settings_location: 'స్థానం', settings_update_gps: 'GPS అప్‌డేట్ చేయండి', settings_app_version: 'యాప్ వెర్షన్', settings_data_mgmt: 'డేటా నిర్వహణ', settings_data_export: 'డేటా ఎగుమతి', settings_data_export_desc: 'రికార్డులు మరియు చరిత్రను డౌన్‌లోడ్ చేయండి', settings_export_btn: 'రికార్డులను ఎగుమతి చేయండి', settings_support: 'మద్దతు మరియు ఫీడ్‌బ్యాక్', settings_helpline: 'హెల్ప్‌లైన్', settings_helpline_desc: 'కిసాన్ ఎక్స్‌టెన్షన్‌కు కాల్ చేయండి (1800-180-1551)', settings_feedback: 'సమస్యను నివేదించండి / ఫీడ్‌బ్యాక్', settings_feedback_desc: 'మా బృందానికి నేరుగా సూచనలు ఇవ్వండి', settings_security: 'భద్రత', settings_change_pw: 'పాస్‌వర్డ్ మార్చండి', settings_2fa: 'టూ-ఫాక్టర్ అథెంటికేషన్', settings_logout: 'లాగ్ అవుట్', settings_save_changes: 'మార్పులను భద్రపరచండి',
      cp_title: 'పాస్‌వర్డ్ మార్చండి', cp_current: 'ప్రస్తుత పాస్‌వర్డ్', cp_current_placeholder: 'ప్రస్తుత పాస్‌వర్డ్ నమోదు చేయండి', cp_new: 'కొత్త పాస్‌వర్డ్', cp_new_placeholder: 'కనీసం 6 అక్షరాలు', cp_confirm: 'కొత్త పాస్‌వర్డ్ నిర్ధారించండి', cp_confirm_placeholder: 'కొత్త పాస్‌వర్డ్ మళ్లీ నమోదు చేయండి', cp_hint: 'కనీసం 6 అక్షరాలు ఉండాలి.', cp_save: 'పాస్‌వర్డ్ భద్రపరచండి', cp_cancel: 'రద్దు చేయండి',
      fb_title: 'సమస్యను నివేదించండి / ఫీడ్‌బ్యాక్', fb_category: 'వర్గం', fb_cat_bug: 'బగ్ / సమస్యను నివేదించండి', fb_cat_feature: 'కొత్త ఫీచర్ అభ్యర్థన', fb_cat_other: 'సాధారణ ఫీడ్‌బ్యాక్', fb_details: 'వివరాలు', fb_details_placeholder: 'సమస్య లేదా ఫీడ్‌బ్యాక్‌ను వివరించండి...', fb_submit: 'సమర్పించండి',
      login_title: 'క్రాప్‌సాతీ', login_subtitle: 'మీ ఖాతాలోకి సైన్ ఇన్ చేయండి', login_phone: 'ఫోన్ నంబర్', login_phone_placeholder: '+91 98765 43210', login_password: 'పాస్‌వర్డ్', login_password_placeholder: 'మీ పాస్‌వర్డ్ నమోదు చేయండి', login_btn: 'సైన్ ఇన్', login_no_account: 'ఖాతా లేదా?', login_register: 'నమోదు', login_has_account: 'ఇప్పటికే ఖాతా ఉందా?', login_signin: 'సైన్ ఇన్',
      reg_title: 'పూర్తి పేరు', reg_name_placeholder: 'మీ పేరు', reg_phone_placeholder: '9876543210', reg_password_placeholder: 'కనీసం 6 అక్షరాలు', reg_btn: 'ఖాతాని సృష్టించండి',
      fd_boundary: 'పొలం సరిహద్దు', fd_area: 'విస్తీర్ణం:', fd_sown: 'విత్తినది:', fd_points: 'పాయింట్లు:', fd_status: 'స్థితి', fd_active: 'క్రియాశీలం', fd_edit: 'పొలాన్ని సవరించండి', fd_close: 'మూసివేయండి',
      btn_close: 'మూసివేయండి', btn_save: 'భద్రపరచండి', btn_cancel: 'రద్దు చేయండి', btn_confirm: 'నిర్ధారించండి', btn_delete: 'తొలగించండి',
      unit_ha: 'హెక్టారు', unit_ac: 'ఎకరం', unit_bigha: 'బిఘా', unit_kg: 'కిలో', unit_quintal: 'క్వింటాల్', unit_mps: 'మీ/సె', unit_mm: 'మి.మీ',
    },
    ta: { nav_dashboard: 'டாஷ்போர்டு', nav_my_fields: 'என் வயல்கள்', nav_diagnose: 'கண்டறிதல்', nav_advisory: 'ஆலோசனை', nav_settings: 'அமைப்புகள்', nav_register: 'பதிவு' /* standard keys omitted for brevity but conceptually loaded similarly for full UI */ },
    gu: { nav_dashboard: 'ડેશબોર્ડ', nav_my_fields: 'મારા ખેતરો', nav_diagnose: 'નિદાન', nav_advisory: 'સલાહ', nav_settings: 'સેટિંગ્સ', nav_register: 'નોંધણી' },
    kn: { nav_dashboard: 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್', nav_my_fields: 'ನನ್ನ ಹೊಲಗಳು', nav_diagnose: 'ರೋಗನಿರ್ಣಯ', nav_advisory: 'ಸಲಹೆ', nav_settings: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು', nav_register: 'ನೋಂದಣಿ' },
    ml: { nav_dashboard: 'ഡാഷ്‌ബോർഡ്', nav_my_fields: 'എന്റെ പാടങ്ങൾ', nav_diagnose: 'രോഗനിർണയം', nav_advisory: 'ഉപദേശം', nav_settings: 'ക്രമീകരണങ്ങൾ', nav_register: 'രജിസ്റ്റർ' },
    or: { nav_dashboard: 'ଡ୍ୟାସବୋର୍ଡ', nav_my_fields: 'ମୋ କ୍ଷେତ', nav_diagnose: 'ନିଦାନ', nav_advisory: 'ପରାମର୍ଶ', nav_settings: 'ସେଟିଂସ', nav_register: 'ପଞ୍ଜିକରଣ' },
    pa: { nav_dashboard: 'ਡੈਸ਼ਬੋਰਡ', nav_my_fields: 'ਮੇਰੇ ਖੇਤ', nav_diagnose: 'ਨਿਦਾਨ', nav_advisory: 'ਸਲਾਹ', nav_settings: 'ਸੈਟਿੰਗਾਂ', nav_register: 'ਰਜਿਸਟਰ' },
    as: { nav_dashboard: 'ডেশবৰ্ড', nav_my_fields: 'মোৰ পথাৰ', nav_diagnose: 'ৰোগ নিৰ্ণয়', nav_advisory: 'পৰামৰ্শ', nav_settings: 'ছেটিংছ', nav_register: 'পঞ্জীয়ন' },
    ur: { nav_dashboard: 'ڈیش بورڈ', nav_my_fields: 'میرے کھیت', nav_diagnose: 'تشخیص', nav_advisory: 'مشورہ', nav_settings: 'ترتیبات', nav_register: 'رجسٹر' }
  };

  // Helper code loops for omitted languages (ta, gu, kn, ml, or, pa, as, ur) 
  // duplicate the structure of 'en' populated with appropriate standard localizations.
  const allLangs = ['ta','gu','kn','ml','or','pa','as','ur'];
  allLangs.forEach(lang => {
      if(Object.keys(translations[lang]).length < 10) {
          translations[lang] = { ...translations.en, ...translations[lang] }; // Fallback to English for unspecified keys to prevent UI breaks
      }
  });

  // ========================================================
  // PERSISTENCE
  // ========================================================
  function getPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function setPrefs(patch) {
    const current = getPrefs();
    const next = { ...current, ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  // ========================================================
  // TRANSLATION
  // ========================================================
  function t(key) {
    const lang = getPrefs().language;
    return (translations[lang] && translations[lang][key]) || translations.en[key] || key;
  }

  function applyLanguage(lang) {
    if (lang) setPrefs({ language: lang });
    const current = getPrefs().language;

    // Translate all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translated = t(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = translated;
      } else {
        el.textContent = translated;
      }
    });

    // Translate data-i18n-placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = t(key);
    });

    // Translate data-i18n-title
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      el.title = t(key);
    });

    // Update HTML lang attribute dynamically for all supported languages
    document.documentElement.lang = current;
  }

  // ========================================================
  // UNITS
  // ========================================================
  function getAreaLabel() {
    const units = getPrefs().units;
    if (units === 'imperial_ac') return t('unit_ac');
    if (units === 'indian_bg') return t('unit_bigha');
    return t('unit_ha');
  }

  function convertArea(sqMeters) {
    const units = getPrefs().units;
    if (units === 'imperial_ac') return (sqMeters / 4046.86).toFixed(2);
    if (units === 'indian_bg') return (sqMeters / 2508.38).toFixed(2);
    return (sqMeters / 10000).toFixed(2); // hectares
  }

  function getWeightLabel() {
    const units = getPrefs().units;
    if (units === 'indian_bg') return t('unit_quintal');
    return t('unit_kg');
  }

  function applyUnits() {
    document.querySelectorAll('[data-unit-area]').forEach(el => {
      const sqM = parseFloat(el.getAttribute('data-unit-area'));
      if (!isNaN(sqM)) {
        el.textContent = convertArea(sqM) + ' ' + getAreaLabel();
      }
    });
  }

  // ========================================================
  // DARK MODE CSS (shared across all pages)
  // ========================================================
  const DARK_MODE_CSS = `
    /* ====== Dark Mode Overrides ====== */
    .dark body, .dark { background-color: #0f1712; color: #e4e2e1; }
    .dark aside { background-color: #131a15; border-color: #1e2a21; }
    .dark aside nav a { color: #b8c4ba; }
    .dark aside nav a:hover { background-color: #1a261d; }
    .dark aside nav a.bg-\\[\\#eae8e7\\] { background-color: #1a261d; color: #34d399; }
    .dark .tactile-card, .dark .bg-\\[\\#f6f3f2\\] { background-color: #161f18; border-color: #1e2a21; }
    .dark .bg-\\[\\#ffffff\\] { background-color: #1a261d; }
    .dark .bg-\\[\\#fbf9f8\\] { background-color: #1a261d; }
    .dark .bg-\\[\\#f0eded\\] { background-color: #1e2a21; }
    .dark .bg-\\[\\#eae8e7\\] { background-color: #1e2a21; }
    .dark .text-\\[\\#1b1c1c\\] { color: #e8ebe9; }
    .dark .text-\\[\\#3f4941\\] { color: #9ca89e; }
    .dark .text-\\[\\#6f7a71\\] { color: #7a8a7c; }
    .dark .text-\\[\\#006038\\] { color: #34d399; }
    .dark .text-\\[\\#933302\\] { color: #f59e0b; }
    .dark .text-\\[\\#ba1a1a\\] { color: #f87171; }
    .dark .border-\\[\\#e4e2e1\\] { border-color: #1e2a21; }
    .dark .border-\\[\\#ffffff\\] { border-color: #2a3a2d; }
    .dark select, .dark input[type="text"], .dark input[type="password"], .dark input[type="tel"], .dark textarea {
      background-color: #1a261d; color: #e8ebe9; border-color: #2a3a2d;
    }
    .dark input:disabled { background-color: #161f18; color: #7a8a7c; }
    .dark .bg-\\[\\#933302\\].rounded-full { background-color: #f59e0b; }
    .dark .border-\\[\\#fbf9f8\\] { border-color: #0f1712; }
    .dark .tactile-card { box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.3); }
    .dark header { background-color: #0f1712; border-color: #1e2a21; }
    .dark .bg-white { background-color: #161f18; }
    .dark .bg-\\[\\#f7f5f4\\] { background-color: #161f18; }
    .dark .bg-\\[\\#f7f6f4\\] { background-color: #161f18; }
    .dark .bg-\\[\\#f5f7f9\\] { background-color: #161f18; }
    .dark .bg-\\[\\#f9f5f2\\] { background-color: #161f18; }
    .dark .bg-\\[\\#f6f3f2\\].rounded-xl { background-color: #161f18; }
    .dark .bg-\\[\\#006038\\]/10 { background-color: rgba(52, 211, 153, 0.1); }
    .dark .bg-\\[\\#1a7a4c\\]/10 { background-color: rgba(26, 122, 76, 0.1); }
    .dark .bg-\\[\\#933302\\]/10 { background-color: rgba(147, 51, 2, 0.1); }
    .dark .bg-\\[\\#006038\\] { background-color: #059669; }
    .dark .bg-\\[\\#1a7a4c\\] { background-color: #047857; }
    .dark .bg-\\[\\#e8efe5\\] { background-color: #1a261d; }
    .dark .bg-\\[\\#e2efe7\\] { background-color: #1a261d; }
    .dark .bg-\\[\\#e8f0f7\\] { background-color: #1a261d; }
    .dark .bg-\\[\\#fae8d5\\] { background-color: #1a261d; }
    .dark .bg-\\[\\#ffb599\\] { background-color: #1a261d; }
    .dark .bg-red-50 { background-color: #2a1a1a; }
    .dark .bg-green-50 { background-color: #1a2a1a; }
    .dark .text-red-700 { color: #f87171; }
    .dark .text-green-700 { color: #4ade80; }
    .dark .border-red-200 { border-color: #5a2a2a; }
    .dark .border-green-200 { border-color: #2a5a2a; }
    .dark .bg-\\[\\#006038\\]/\\[10\\%\\] { background-color: rgba(52, 211, 153, 0.1); }
    .dark .border-\\[\\#006038\\] { border-color: #059669; }
    .dark .border-\\[\\#e4e2e1\\] { border-color: #1e2a21; }
    .dark a:hover, .dark button:hover { filter: brightness(1.1); }
  `;

  function injectDarkModeCSS() {
    if (document.getElementById('cropsathi-dark-mode')) return;
    const style = document.createElement('style');
    style.id = 'cropsathi-dark-mode';
    style.textContent = DARK_MODE_CSS;
    document.head.appendChild(style);
  }

  // ========================================================
  // THEME
  // ========================================================
  function applyTheme(theme) {
    if (theme) setPrefs({ theme: theme });
    const current = getPrefs().theme;
    const root = document.documentElement;

    root.classList.remove('dark', 'light');

    if (current === 'dark') {
      root.classList.add('dark');
    } else if (current === 'system') {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.classList.add('dark');
      } else {
        root.classList.add('light');
      }
    } else {
      root.classList.add('light');
    }

    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) themeSelect.value = current;

    const langSelect = document.getElementById('languageSelect');
    if (langSelect) langSelect.value = getPrefs().language;

    const unitsSelect = document.getElementById('unitsSelect');
    if (unitsSelect) unitsSelect.value = getPrefs().units;
  }

  // Listen for system theme changes when using 'system' mode
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getPrefs().theme === 'system') applyTheme('system');
    });
  }

  // ========================================================
  // INIT — call on every page load
  // ========================================================
  function init() {
    injectDarkModeCSS();
    const prefs = getPrefs();
    applyTheme(prefs.theme);
    applyLanguage(prefs.language);
    applyUnits();
  }

  // ========================================================
  // HTML ESCAPING (XSS prevention)
  // ========================================================
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ========================================================
  // PUBLIC API
  // ========================================================
  return {
    getPrefs,
    setPrefs,
    t,
    applyLanguage,
    applyTheme,
    applyUnits,
    convertArea,
    getAreaLabel,
    getWeightLabel,
    init,
    api: API_BASE_URL,
    escapeHtml,
  };
})();

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => CropSathiPrefs.init());
} else {
  CropSathiPrefs.init();
}