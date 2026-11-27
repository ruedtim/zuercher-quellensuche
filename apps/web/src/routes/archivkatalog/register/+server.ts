// /archivkatalog/register – Einstieg ins Register: die Personen.

import { redirect } from "@sveltejs/kit";
import { registerHref } from "$lib/catalogRegister";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => redirect(302, registerHref("personen"));
