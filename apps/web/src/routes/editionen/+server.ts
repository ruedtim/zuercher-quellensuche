// /editionen ohne Stück: der Reiter «Editionen» der Suchseite.
import { redirect } from "@sveltejs/kit";
import { searchViewHref } from "$lib/searchViews";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => redirect(302, searchViewHref("editions"));
