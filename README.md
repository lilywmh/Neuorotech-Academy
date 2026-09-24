# Neurotech Academy Portal

A responsive, zero-dependency prototype for the Neurotech Academy learner and admin experience.

## Preview

Open `index.html` directly in a browser, or run any static file server from this folder.

## Included in this prototype

- Learner home with the next session, preparation, progress, and eight-session journey
- Syllabus with three acts and eight connected sessions
- Searchable/filterable library for current, past, and external materials
- Private participation and project-readiness page
- Demo check-in flow (use code `241008`)
- Admin dashboard and live check-in demonstration
- Responsive mobile navigation
- Sign-in screen with learner/admin role previews and persistent demo sessions

## Demo sign-in

The sign-in screen includes learner and admin previews. These use local browser storage so the complete role-based flow can be tested without a backend. Google Authentication is connected to the `neurotech-academy-1c5d3` Firebase project and becomes available when the site is served over HTTP or deployed to Firebase Hosting.

Add lowercase organizer emails to `NEUROTECH_ADMIN_EMAILS` in `firebase-config.js` to grant the admin interface. Do not use this client-side list as the final authorization mechanism for Firestore data; production data access must also be protected by Firestore Security Rules.

## Before launch

Replace placeholder resource links with Google Drive, Slides, Colab, and Form URLs. The current check-in and profile data are demo-only; connect them to Firebase Authentication and Firestore when the content structure is approved.
