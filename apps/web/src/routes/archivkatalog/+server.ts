// /archivkatalog – Einstieg in den Archivbaum: die Wurzel des Archivplans.

import { redirect } from "@sveltejs/kit";
import { CATALOG_ROOT_ID, catalogUnitHref } from "$lib/catalog";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => redirect(302, catalogUnitHref(CATALOG_ROOT_ID));
