// RI'S ART — all editable content lives here.
// Anything marked PLACEHOLDER must be replaced with real details before launch.

window.RISART = {
  brand: "RI'S ART",
  city: "Your City",                         // PLACEHOLDER
  whatsapp: "919825744110",                  // country code + number, digits only
  phone: "+91 00000 00000",                  // PLACEHOLDER
  instagram: "risart.nails",                 // PLACEHOLDER — handle without @
  address: "Studio address, Area, City 000000", // PLACEHOLDER
  mapUrl: "https://maps.google.com/?q=RI'S+ART", // PLACEHOLDER
  hours: [                                   // PLACEHOLDER
    ["Mon – Fri", "11:00 – 20:00"],
    ["Saturday", "10:00 – 21:00"],
    ["Sunday", "By appointment"],
  ],

  // Scroll film — one entry per beat. Keep each line short. pos: "top" | "bottom" moves the text off the action.
  // vh = how long the beat holds while scrolling; longer beats get more of the film.
  beats: [
    { logo: true, kicker: "RI'S ART · Nail Atelier", h: "Couture nails, crafted by hand", p: "Bespoke gel, sculpted extensions and freehand art. Private appointments, one client at a time.", vh: 120 },
    { kicker: "The colour", h: "Chosen with intention", p: "Rich, pigment-dense lacquers matched to your skin tone, your style and your moment.", vh: 96 },
    { kicker: "The finish", h: "Precision in every stroke", p: "Meticulous cuticle care, then a self-levelling gel with a mirror shine that lasts up to three weeks.", pos: "top", vh: 90 },
    { kicker: "The detail", h: "Art that catches the light", p: "Gold leaf, chrome, pearls and hand-painted design, sketched with you and finished by hand.", pos: "top", vh: 180 },
    { kicker: "Your appointment", h: "Your signature set awaits", p: "Explore the menu, try a look on your own hands, then reserve your chair below.", pos: "top", vh: 130 },
  ],

  // Portrait screens only see a slice of the 16:9 film. The crop follows the action:
  // [film second, horizontal crop position %]. Retune if the film changes.
  focus: [[0, 22], [2.2, 30], [3.6, 48], [7.4, 50], [8.2, 52], [15.4, 58]],

  // Menu — prices are PLACEHOLDERS. `shade` colours the swatch chip; `tryon` is the look the AR try-on opens with.
  menu: [
    {
      group: "Polish & gel",
      items: [
        { name: "Classic polish", note: "Shape, cuticle care, two coats and a top coat.", time: "40 min", price: 499, shade: "#C98B86", tryon: { shade: "#D9A39B", design: "gloss", shape: "round", length: "natural" } },
        { name: "Gel polish", note: "Chip-free colour that stays glossy for 2–3 weeks.", time: "60 min", price: 999, shade: "#A8122E", tryon: { shade: "#A8122E", design: "gloss", shape: "almond", length: "natural" } },
        { name: "French, any colour", note: "Clean smile line, classic white or your shade.", time: "70 min", price: 1199, shade: "#F3E6E1", tryon: { shade: "#FBF7F3", design: "french", shape: "square", length: "short" } },
      ],
    },
    {
      group: "Extensions",
      items: [
        { name: "Gel extensions", note: "Almond, coffin, square or stiletto. Includes plain gel colour.", time: "2 hr", price: 1999, shade: "#E7B7AE", tryon: { shade: "#EBC0B8", design: "gloss", shape: "almond", length: "medium" } },
        { name: "Acrylic extensions", note: "Strong and long-lasting, built to your length.", time: "2 hr", price: 2199, shade: "#D9A39B", tryon: { shade: "#D9A39B", design: "gloss", shape: "coffin", length: "long" } },
        { name: "Refill", note: "Fill regrowth and repaint, within 3 weeks of your set.", time: "75 min", price: 1199, shade: "#C5767A", tryon: { shade: "#9C6B7A", design: "gloss", shape: "almond", length: "medium" } },
      ],
    },
    {
      group: "Art & finish",
      items: [
        { name: "Nail art, per set", note: "Hand-painted designs: florals, lines, abstract, characters.", time: "+30 min", price: 499, shade: "#5E0A1B", tryon: { shade: "#5E0A1B", design: "foil", shape: "almond", length: "medium" } },
        { name: "Chrome & cat-eye", note: "Mirror chrome, aurora or magnetic cat-eye on any gel.", time: "+20 min", price: 399, shade: "#B8925A", tryon: { shade: "#B8925A", design: "chrome", shape: "almond", length: "medium" } },
        { name: "Bridal set", note: "A custom design session, trial nail and your wedding-day set.", time: "3 hr", price: 3999, shade: "#8E1B2E", tryon: { shade: "#A8122E", design: "foil", shape: "almond", length: "long" } },
      ],
    },
    {
      group: "Care",
      items: [
        { name: "Gel or extension removal", note: "Gentle soak-off, no drilling into your natural nail.", time: "30 min", price: 299, shade: "#EAD2CC" },
        { name: "Spa manicure", note: "Soak, scrub, massage and a strengthening coat.", time: "50 min", price: 799, shade: "#F1D9D3" },
      ],
    },
  ],

  // AR try-on. Shades shown in the camera view.
  tryon: {
    chirality: 1,                 // calibrated against a back-of-hand photo; do not change
    frenchBase: "#E6BDB4",
    shades: [
      { name: "Deep crimson", hex: "#A8122E" },
      { name: "Cherry", hex: "#C41A3A" },
      { name: "Wine", hex: "#5E0A1B" },
      { name: "Rose nude", hex: "#D9A39B" },
      { name: "Blush", hex: "#EBC0B8" },
      { name: "Milky white", hex: "#FBF7F3" },
      { name: "Mauve", hex: "#9C6B7A" },
      { name: "Coral", hex: "#E0674F" },
      { name: "Lilac", hex: "#B9A3D6" },
      { name: "Sage", hex: "#9FB39A" },
      { name: "Gold", hex: "#B8925A" },
      { name: "Midnight", hex: "#1E1A2E" },
      { name: "Cloud dancer", hex: "#F1EDE6" },
      { name: "Cherry mocha", hex: "#6E1F2A" },
      { name: "Espresso", hex: "#4A2C22" },
      { name: "Butter", hex: "#F3E3A1" },
    ],
    // designs, shapes and lengths come from nailshape.js (salon shape chart + 2026 design trends)
  },

  // Look book — PLACEHOLDER: these are stills from the AI brand film, not client work.
  // Replace with photos of Ri's real sets (4:5 crops look best) before launch.
  looks: [
    { src: "assets/looks/look-1.jpg", name: "Deep crimson" },
    { src: "assets/looks/look-2.jpg", name: "The first stroke" },
    { src: "assets/looks/look-3.jpg", name: "Almond, full set" },
    { src: "assets/looks/look-4.jpg", name: "Gold-leaf detail" },
  ],

  faq: [
    ["How long does gel last?", "Two to three weeks on natural nails, three to four on extensions. Book a refill or removal before it lifts."],
    ["Will extensions damage my nails?", "Not when they are applied and removed properly. We never peel or drill into the natural nail, and removal is always a soak-off."],
    ["Can I bring a design reference?", "Yes. Send a photo on WhatsApp when you book so Ri can plan the time and quote the art."],
    ["How do you keep tools clean?", "Metal tools are sterilised after every client. Files and buffers are single-use and yours to take home."],
    ["What if I need to reschedule?", "Message on WhatsApp at least 24 hours ahead and we will move your slot."],
  ],
};
