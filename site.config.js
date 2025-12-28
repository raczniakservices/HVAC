export const SITE_CONFIG = {
  companyName: "Blue Ridge Heating & Air",
  tagline: "Repairs, maintenance, and emergency service",

  phoneDisplay: "(443) 665-0603",
  phoneTel: "+14436650603",

  primaryCity: "Baltimore, MD",
  serviceAreas: ["Baltimore", "Towson", "Catonsville", "Parkville", "Dundalk", "Surrounding areas"],

  // Branding images (add files under ./assets/brand/)
  logoUrl: "./assets/brand/logo.png",
  heroImageUrl: "./assets/brand/hero.jpg",
  aboutImageUrl: "./assets/brand/about.jpg",
  ratingBannerUrl: "./assets/brand/rating-banner.png",
  satisfactionSealUrl: "./assets/brand/satisfaction-seal.png",

  services: [
    { title: "AC Repair", desc: "Restore cooling fast with clear options and upfront approval.", iconUrl: "./assets/brand/icon-ac.png", iconAlt: "AC" },
    { title: "Furnace Repair", desc: "Diagnose no-heat and safety issues with straightforward next steps.", iconUrl: "./assets/brand/icon-furnace.png", iconAlt: "Furnace" },
    { title: "Heat Pumps", desc: "Troubleshooting, repairs, and replacement guidance for your home.", icon: "♨" },
    { title: "Maintenance", desc: "Seasonal tune-ups to reduce breakdowns and improve comfort.", icon: "🧰" },
    { title: "Thermostats", desc: "Smart thermostat installs, wiring fixes, and schedule setup.", icon: "🎛" },
    { title: "Ductwork", desc: "Airflow issues, leaks, and comfort balancing without guesswork.", icon: "🌀" },
    { title: "Indoor Air Quality", desc: "Filtration and humidity solutions for cleaner, comfortable air.", icon: "🌬" },
    { title: "Emergency Service", desc: "Urgent response for no-heat/no-AC situations when it can’t wait.", icon: "⚡" },
  ],

  testimonials: [
    {
      name: "Sarah M.",
      city: "Baltimore",
      text:
        "Called Saturday morning and they walked me through options right away. Clear pricing, no surprises, and we were comfortable again the same day.",
      stars: 5,
    },
    {
      name: "Mike T.",
      city: "Towson",
      text:
        "Quick response and great communication. The technician explained what failed and what it would take to fix it before starting any work.",
      stars: 5,
    },
    {
      name: "Jennifer K.",
      city: "Catonsville",
      text:
        "Professional, on time, and respectful of the house. Diagnosed the issue fast and gave me a couple of repair options to choose from.",
      stars: 5,
    },
  ],

  hours: "Mon–Sun: 8am–8pm",
  emergencyLine: "Emergency service available",
  licenseNumber: "",

  about:
    "Locally owned HVAC team serving the greater Baltimore area. Licensed, insured, and focused on fast, clear communication from the first call to the final walkthrough.",

  trustStrip: ["Licensed & insured", "Same-day availability", "Upfront options", "Text updates available"],

  theme: {
    primaryColor: "#0b5fff",
    accentColor: "#083a9a",
  },

  enableHeroImage: true,
  heroBackgroundImageUrl: "./assets/brand/hero.jpg",
};


