// /editionen/<edition> ohne Stück: der Reiter «Editionen», eingegrenzt auf diese Edition.
import { error, redirect } from "@sveltejs/kit";
import { isIndexedEdition } from "$lib/editionTexts";
import { searchViewHref } from "$lib/searchViews";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ params }) => {
	if (!isIndexedEdition(params.edition)) error(404, "Edition nicht gefunden");
	redirect(302, searchViewHref("editions", { edEdition: params.edition }));
};
