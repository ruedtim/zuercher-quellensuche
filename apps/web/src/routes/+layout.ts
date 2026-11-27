// Root-Layout darf weder server-only Daten laden noch dynamisch sein —
// damit prerender-able Routen (`/`, `/about/*`, `/impressum`, `/datenschutz`)
// statisch ausgeliefert werden können.
export const trailingSlash = "never";
