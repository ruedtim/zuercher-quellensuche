/**
 * Typen der Fotoporträts aus dem Bestand Z 1114 des Staatsarchivs. Der Abruf und die Bilder sind
 * nicht Teil dieses Repos; ohne data/z1114.json zeigt das Register nur Porträts von Commons.
 */

import { fileURLToPath } from "node:url";

export const CATALOG_PERMALINK = "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=";
export const DEFAULT_DATA = fileURLToPath(new URL("../data/z1114.json", import.meta.url));

export interface Z1114Portrait {
  ve: number;
  signature: string;
  title: string;
  period?: string;
  author?: string;
  files: string[];
  img?: { path: string; width: number; height: number; v: string };
}

export interface Z1114Dossier {
  ve: number;
  signature: string;
  title: string;
  council: "Kantonsrat" | "Regierungsrat";
  krdbIds: number[];
  portraits: Z1114Portrait[];
}

export interface Z1114Data {
  meta: { generatedAt: string; source: string; dossiers: number; withScan: number; withImage: number };
  dossiers: Z1114Dossier[];
}
