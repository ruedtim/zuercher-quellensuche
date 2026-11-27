// Dokument-ID: die Zeichen, die Meili für Primärschlüssel zulässt. Jede ID aus URL, Suchparameter
// oder Werkzeug-Argument wird hier geprüft, bevor sie in eine Meili-Adresse (meilisearch-js kodiert
// sie nicht) oder einen Dateipfad geht – sonst führte `../` oder `#` zu anderen Endpunkten und Dateien.

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,511}$/;

export function isDocumentId(id: unknown): id is string {
	return typeof id === "string" && DOCUMENT_ID.test(id);
}
