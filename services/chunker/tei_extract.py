"""TEI-Extraktion für die Chunk-Pipeline – repliziert parse_XML_files() aus
ai-search_staatsarchiv/staatsarchiv_utils.py (BeautifulSoup + lxml):

- title aus <sourceDesc><title>
- text aus <text>: direkte Kinder iterieren; <table> zellenweise (row/cell,
  Zellen mit Leerzeichen gejoint), alles andere via .text. Falls <text> nur
  einen <body>-Wrapper hat (übliche TEI-Struktur), wird in dessen Kinder
  abgestiegen – die alte Pipeline lief auf denselben TEI-Strukturen.

docId = Dateinamen-Stamm (identisch mit der ID im neuen documents-Index).
"""

from pathlib import Path

from bs4 import BeautifulSoup


def extract(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        soup = BeautifulSoup(fh, "lxml")

    title = ""
    sourcedesc = soup.sourcedesc
    if sourcedesc is not None and sourcedesc.title is not None:
        title = sourcedesc.title.get_text()

    text_el = soup.find("text")
    tmp_text: list[str] = []
    if text_el is not None:
        children = text_el.find_all(recursive=False)
        # <text><body>…</body></text>-Wrapper transparent durchsteigen.
        if len(children) == 1 and children[0].name == "body":
            children = children[0].find_all(recursive=False)
        for elem in children:
            if elem.name == "table":
                for row in elem.find_all("row"):
                    for cell in row.find_all("cell"):
                        if cell.text:
                            tmp_text.append(cell.text)
            else:
                if elem.text:
                    tmp_text.append(elem.text)

    return {
        "docId": path.stem,
        "title": title,
        "text": " ".join(tmp_text),
    }
