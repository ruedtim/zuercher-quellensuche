// /editionen/register – Einstieg ins Register der Editionen: die Personen.

import { redirect } from "@sveltejs/kit";
import { editionRegisterHref } from "$lib/editionRegister";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => redirect(302, editionRegisterHref("personen"));
