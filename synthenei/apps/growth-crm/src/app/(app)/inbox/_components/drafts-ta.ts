// Tamil versions of the canned reply drafts (sample content, keyed by conversation id; {first} = contact's first name).
// Shown with "Check translation" per spec section 9. Replace with generated drafts when the feature is live.
export const TAMIL_DRAFTS: Record<string, string> = {
  "CV-71": "வணக்கம் {first}, வியாழன் மாலை 5.30 மணி சரி. 30 நிமிடம் ஒதுக்கி, உங்களுக்கும் செல்விக்கும் Google Meet இணைப்பை அனுப்ப முடியும். அழைப்புக்கு முன் 3–4 வழக்கு எண்களை (மதுரை கிளை + மாவட்ட நீதிமன்றம்) பகிர்ந்தால், உங்கள் சொந்த விசாரணைப் பட்டியலை நேரலையில் காட்டுகிறேன்.",
  "CV-72": "அன்புள்ள {first}, எழுத்தர்களுக்கு கட்டணமில்லா \"staff\" இருக்கை (நாட்காட்டி, டைரி மட்டும்) உண்டு. எனவே 11 வழக்கறிஞர் இருக்கைகளுக்கு Chambers திட்டத்தில் ஆண்டுக்கு ₹2,37,600, GST தனி. அனைத்து தரவும் AWS மும்பை பகுதியில் சேமிக்கப்படுகிறது; இந்தியாவை விட்டு வெளியே செல்லாது. வெள்ளிக்கிழமை மாலை 4 மணிக்கு ஒரு சிறிய அழைப்பில் உங்கள் பங்குதாரர்களுக்கு விளக்கலாமா?",
  "CV-73": "புரிகிறது — விசாரணைக்கு வாழ்த்துகள். செவ்வாய்க்கிழமை மீண்டும் தொடர்பு கொள்கிறேன். அதுவரை, மாதிரி Madras High Court டைரியில் காலை 7 மணி சுருக்கத்தின் 2 நிமிடப் பதிவை அனுப்புகிறேன்; ஜூனியர்கள் உண்மையில் படிப்பார்களா என்று நீங்களே பாருங்கள்.",
  "CV-74": "எளிது — Settings → Import → \"Case diary (Excel)\" பயன்படுத்துங்கள். எங்கள் வார்ப்புரு வழக்கு எண், நீதிமன்றம், அடுத்த தேதி, கட்சிக்காரர் ஆகியவற்றைப் பொருத்தும். 6 ஆண்டுத் தரவுக்கு, கோப்பை மின்னஞ்சலில் அனுப்பினால் ஒரு வேலை நாளுக்குள் நாங்களே இறக்குமதி செய்து தருகிறோம்.",
  "CV-75": "புரிகிறது, {first}. எங்கள் நிலையான ஒப்பந்தத்தில் (Schedule B, 4.2) வாடிக்கையாளர் ஆவணங்கள் எந்த மாதிரிப் பயிற்சிக்கும் பயன்படுத்தப்படாது என்ற விதி ஏற்கனவே உள்ளது. அந்த விதியின் சரியான வாசகத்தை இன்று பகிர்கிறேன்; உங்கள் மூத்த பங்குதாரருக்கு வேறு வாசகம் தேவைப்பட்டால், எங்கள் சட்ட ஆலோசகர் திருத்திய பதிப்பைப் பரிசீலிப்பார்.",
  "CV-76": "பரவாயில்லை, {first}. சனிக்கிழமை காலை 10.30 அல்லது 11.30 — எது உங்களுக்கு வசதி? உறுதி செய்தவுடன் அழைப்பை மாற்றுகிறேன்.",
};

export const EMAIL_TEMPLATES = [
  { id: "demo_recap_en", lang: "English", body: "Dear {{1}}, thank you for your time today. As promised, here is the recap of the demo and the trial workspace link for {{2}}." },
  { id: "pricing_note_en", lang: "English", body: "Dear {{1}}, please find the annual pricing for {{2}} attached. Clerks use free staff seats; prices exclude GST." },
  { id: "security_note_en", lang: "English", body: "Dear {{1}}, attaching our data-handling note: data is hosted in AWS Mumbai and customer content is never used to train models." },
];
