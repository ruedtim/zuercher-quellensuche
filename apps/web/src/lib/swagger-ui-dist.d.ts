// Subpath-Import des Swagger-UI-Bundles ist in @types/swagger-ui-dist nicht
// deklariert – minimale Ambient-Declaration für den dynamic import in
// routes/api-doc/+page.svelte (Vite-CJS-Interop liefert default).
declare module "swagger-ui-dist/swagger-ui-es-bundle.js" {
	const SwaggerUIBundle: (config: Record<string, unknown>) => unknown;
	export default SwaggerUIBundle;
}
declare module "swagger-ui-dist/swagger-ui.css";
