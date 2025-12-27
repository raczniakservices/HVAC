# 🚀 HVAC Demo Landing Page - START HERE

## Quick Links

- **📄 View Demo Locally**: Open `index.html` in browser or run `npx --yes http-server . -p 4173 -c-1`
- **📞 Missed Call Visibility Demo (Simulator + Dashboard)**: Run the local server (below) then open `/demo` and `/dashboard`
- **📖 User Documentation**: See `README.md`
- **🔧 Developer Notes**: See `IMPROVEMENTS_LOG.md`
- **✅ Original Spec**: See `HVAC_DEMO_MASTER_BUILD_CHECKLIST.txt`

---

## What Is This?

A **production-ready HVAC landing page demo** designed to show business owners what a conversion-focused website looks like.

This isn't a template. It's a **sales tool**.

---

## Features (The Elevator Pitch)

✅ **Modern Design** - Inter font, smooth animations, professional polish
✅ **Mobile-First** - Sticky action bar, one-thumb form filling
✅ **Zero Friction** - No menus, no blog, no dead ends
✅ **Social Proof** - Customer testimonials with star ratings
✅ **Urgency Indicators** - "Available Today" badge with pulse effect
✅ **SEO Ready** - Schema markup, meta tags, fast loading
✅ **Form + Phone** - Multiple conversion paths, always visible
✅ **Analytics Ready** - Google Analytics placeholder included

---

## File Structure

```
hvac-demo-landing/
│
├── 📄 START_HERE.md              ← You are here
├── 📖 README.md                  ← User documentation
├── 🔧 IMPROVEMENTS_LOG.md        ← Developer notes & changelog
├── ✅ HVAC_DEMO_MASTER_BUILD_CHECKLIST.txt  ← Original requirements
│
├── 🌐 index.html                 ← The landing page (all content here)
├── 🎨 styles.css                 ← All styles (no preprocessor)
├── ⚡ app.js                     ← Form handling + animations
│
└── assets/
    └── hvac-hero.svg             ← Background illustration
```

---

## How to Use This

### For Demo/Testing:
1. Open `index.html` in a browser
2. Or run: `npx --yes http-server . -p 4173 -c-1`
3. Test on mobile (most HVAC searches are mobile)

### Missed Call Visibility Demo (Simulator + Dashboard):
This demo adds:
- `/demo`: a simulator that posts to the same webhook shape Twilio would call
- `/dashboard`: a small dashboard showing the last 50 call events

How it relates to the landing page:
- Open the landing with `?demo=1` to reveal footer links to `/demo` and `/dashboard`.
- In demo mode (`?demo=1`), when you submit the landing page form, it will also log a demo “missed call” event (using the phone number you entered) so it shows up in `/dashboard`.

To run it locally:
1. `cd hvac-demo-landing`
2. Copy `env.example` → `.env` and set `DEMO_KEY`
3. `npm install`
4. `npm run db:migrate`
5. `npm run dev`
6. Open: `http://127.0.0.1:4173/?demo=1` then use the footer Demo links

### For Sales Calls:
1. Deploy to Render/Netlify (see README.md)
2. Pull up on your phone during discovery calls
3. Show side-by-side with their current site
4. Walk through the conversion path

### For Real Client:
1. Follow "Client Customization Checklist" in `IMPROVEMENTS_LOG.md`
2. Replace phone numbers, testimonials, location data
3. Add Formspree endpoint in `app.js`
4. Insert Google Analytics tracking ID
5. Deploy to custom domain

---

## Tech Stack (What You Need to Know)

- **HTML5** - Semantic markup, accessibility built-in
- **CSS3** - Modern features, custom properties, no Sass needed
- **Vanilla JavaScript** - No jQuery, React, or framework bloat
- **AOS Library** - Scroll animations (13KB, CDN)
- **Inter Font** - Google Fonts (modern typography)
- **Formspree** - Form backend (endpoint configurable)

**Total external dependencies: 2** (AOS + Font)

---

## Quick Wins to Show Clients

1. **"Form above the fold"** - Scroll to show it's immediately visible
2. **"Sticky mobile bar"** - Resize browser, show bottom bar
3. **"Multiple call CTAs"** - Count how many times phone appears
4. **"No navigation"** - Explain why menus kill conversions
5. **"Fast loading"** - Refresh and watch it snap into view
6. **"Social proof"** - Scroll to testimonials section
7. **"Available Today badge"** - Point out urgency indicator

---

## Common Questions

### Q: Why no menu?
**A:** Menus give visitors a way to leave. This page has one goal: book the job.

### Q: Where's the about page?
**A:** Trust is built through testimonials + badges, not company history.

### Q: Can I add a blog?
**A:** You *can*, but it'll hurt conversions. Blogs are for SEO. This is for closing.

### Q: Why only 5 form fields?
**A:** Every extra field reduces submissions by ~10%. We kept only what's needed to call back.

### Q: Is this SEO-friendly?
**A:** Yes. Schema markup, fast loading, mobile-friendly. Google loves this.

---

## Performance Targets

- **Load time**: < 2 seconds
- **Lighthouse Performance**: 90+
- **Mobile-friendly**: ✅
- **Accessibility**: 95+
- **Conversion rate**: 5-10% (form submissions)
- **Call click rate**: 15-25%

---

## Next Steps

1. **Read** `README.md` for setup instructions
2. **Review** `IMPROVEMENTS_LOG.md` for technical details
3. **Test** on mobile device (this is where conversions happen)
4. **Deploy** to show clients (Render is easiest, see README)
5. **Customize** for real client when you close a deal

---

## Pro Tip

When demoing to HVAC owners, ask them:

> "How many clicks does it take to request service on your current site?"

Then show them this:

> "On this page? Zero clicks. The form is right there."

That's the conversation closer.

---

**This landing page is ready to deploy. Go book some deals.** 🚀




