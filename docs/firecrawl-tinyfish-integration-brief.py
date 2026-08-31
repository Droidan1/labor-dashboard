# Regenerate: pip install reportlab && python3 docs/firecrawl-tinyfish-integration-brief.py
# Run from the repo root. Source of truth for the partner-facing integration brief;
# edit this rather than the PDF, which is a build artifact checked in for sharing.
# Builds the Firecrawl / TinyFish integration brief as a PDF.
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, KeepTogether, HRFlowable)

OUT = "docs/firecrawl-tinyfish-integration-brief.pdf"

INK     = colors.HexColor("#14110a")
DIM     = colors.HexColor("#5f5949")
GREEN   = colors.HexColor("#0b7a52")
EMERALD = colors.HexColor("#10b981")
RULE    = colors.HexColor("#d8d4c6")
CODEBG  = colors.HexColor("#f4f3ee")
TABLEHD = colors.HexColor("#eceadf")

def S(name, **kw):
    base = dict(name=name, fontName="Helvetica", fontSize=9.6, leading=13.7,
                textColor=INK, alignment=TA_LEFT, spaceAfter=0)
    base.update(kw)
    return ParagraphStyle(**base)

title    = S("title", fontName="Helvetica-Bold", fontSize=20, leading=23.5, spaceAfter=5)
subtitle = S("subtitle", fontSize=10.6, leading=14.5, textColor=DIM, spaceAfter=2)
meta     = S("meta", fontSize=8.4, leading=12, textColor=DIM)
h2       = S("h2", fontName="Helvetica-Bold", fontSize=12.4, leading=15,
             textColor=GREEN, spaceBefore=13, spaceAfter=5)
h3       = S("h3", fontName="Helvetica-Bold", fontSize=10, leading=13.4,
             textColor=INK, spaceBefore=9, spaceAfter=3)
body     = S("body", spaceAfter=6.5)
lead     = S("lead", fontSize=10.4, leading=15, spaceAfter=8)
bullet   = S("bullet", leftIndent=13, bulletIndent=2, spaceAfter=3.5)
cell     = S("cell", fontSize=8.7, leading=12, spaceAfter=0)
cellb    = S("cellb", fontSize=8.7, leading=12, fontName="Helvetica-Bold", spaceAfter=0)
code     = S("code", fontName="Courier", fontSize=8.1, leading=11.4, textColor=INK)
foot     = S("foot", fontSize=7.6, leading=10, textColor=DIM)

def rule(space_before=0, space_after=8, color=RULE, width=0.6):
    return HRFlowable(width="100%", thickness=width, color=color,
                      spaceBefore=space_before, spaceAfter=space_after)

def bullets(items):
    return [Paragraph(t, bullet, bulletText="•") for t in items]

def codeblock(lines):
    inner = [[Paragraph(l.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                        .replace(" ", "&nbsp;"), code)] for l in lines]
    t = Table(inner, colWidths=[6.5*inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), CODEBG),
        ("LEFTPADDING", (0,0), (-1,-1), 11), ("RIGHTPADDING", (0,0), (-1,-1), 11),
        ("TOPPADDING", (0,0), (-1,-1), 1.2), ("BOTTOMPADDING", (0,0), (-1,-1), 1.2),
        ("LINEBEFORE", (0,0), (0,-1), 2, EMERALD),
    ]))
    return t

def datatable(header, rows, widths):
    data = [[Paragraph(h, cellb) for h in header]]
    for r in rows:
        data.append([Paragraph(c, cell) for c in r])
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), TABLEHD),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 7), ("RIGHTPADDING", (0,0), (-1,-1), 7),
        ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("LINEBELOW", (0,0), (-1,-2), 0.4, RULE),
        ("BOX", (0,0), (-1,-1), 0.5, RULE),
    ]))
    return t

def sub(head, text):
    """An h3 heading welded to the paragraph under it, so it never orphans."""
    return KeepTogether([Paragraph(head, h3), Paragraph(text, body)])

MONO = "<font name='Courier' size='9'>%s</font>"

story = []
A = story.append

# ── Header ────────────────────────────────────────────────────────────────────
A(Paragraph("Retail Price Discovery on the Open Web", title))
A(Paragraph("How Bargain Lane uses Firecrawl and TinyFish inside its "
            "operator dashboard", subtitle))
A(Spacer(1, 7))
A(rule(space_after=3, color=EMERALD, width=1.6))
A(Spacer(1, 6))
A(Paragraph("Technical brief &nbsp;·&nbsp; 31 August 2026 &nbsp;·&nbsp; "
            "Bargain Lane Operator Dashboard &nbsp;·&nbsp; Prepared for external technical review",
            meta))
A(Spacer(1, 14))

A(Paragraph(
  "Bargain Lane is a six-store closeout and thrift retail group operating across Indiana and "
  "Michigan. Its operator dashboard runs buy decisions on liquidation inventory. The single "
  "hardest input to that decision — what a customer can actually pay for an item today at a "
  "real retailer — has no API behind it. It lives on the open web. This brief describes the "
  "pipeline built to answer that question, and the specific role each vendor plays in it.", lead))

# ── 1 ─────────────────────────────────────────────────────────────────────────
A(Paragraph("1 &nbsp; The problem", h2))
A(Paragraph(
  "A vendor offers a truckload and sends a spreadsheet. Several hundred lines of warehouse "
  "shorthand — " + MONO % "CASCADE AP COMP FRSH 4CT" + " — each with a unit cost and a column "
  "the vendor labels retail. That last number is the trap. It is supplied by the party with an "
  "interest in the load looking good, and in this pipeline it is stored explicitly "
  "<i>to be contradicted, never to be used</i>. An inflated comparison price makes every "
  "cost-as-a-fraction-of-retail figure look better than it is, in the one direction that loses "
  "money.", body))
A(Paragraph(
  "So the buy decision requires an independently sourced street price, per line, from a "
  "first-party seller — not a marketplace reseller, and not the vendor's own claim. At several "
  "hundred lines per manifest, that is not a research task a human can do. It has to be a "
  "pipeline.", body))

# ── 2 ─────────────────────────────────────────────────────────────────────────
A(Paragraph("2 &nbsp; Where it runs", h2))
A(datatable(
    ["Surface", "What it does", "Shape of the work"],
    [["Manifest Scorer",
      "A vendor manifest is uploaded, every line is priced against real street prices, and the "
      "load is scored against a published, versioned buy-criteria document.",
      "Batch. Our largest run to date is 331 lines. Deduplicated by identifier and cache-first "
      "on a 90-day TTL."],
     ["Price Scan",
      "A store manager on the floor scans a barcode or types a product name and gets back what "
      "the item is, what it sells for elsewhere, our own average selling price for the category, "
      "and a suggested ticket price.",
      "Interactive, single item, latency-sensitive. A manager is standing in an aisle waiting "
      "for it."]],
    [1.15*inch, 2.95*inch, 2.4*inch]))
A(Spacer(1, 8))
A(Paragraph(
  "Both sit on the same lookup core. The stack underneath is a Cloudflare Worker with D1 and KV, "
  "fronting a static vanilla-JS client. Claude Sonnet handles two language tasks: expanding "
  "warehouse abbreviations into searchable product names, and extracting prices from unstructured "
  "page text where no structured data is available.", body))

# ── 3 ─────────────────────────────────────────────────────────────────────────
A(Paragraph("3 &nbsp; The lookup pipeline", h2))
A(Paragraph(
  "The pipeline is an escalation ladder, ordered cheapest-first. Each rung runs only because the "
  "one before it failed to produce a price.", body))
A(Spacer(1, 2))
A(datatable(
    ["Step", "Action", "Cost"],
    [["1 &nbsp;Identify",
      "Resolve the identifier to a brand, product name and size. A barcode is an excellent "
      "identity key and a poor price key, so the name is resolved first and the <i>name</i> is "
      "what gets priced. Identity may come from product databases and regional grocers; pricing "
      "may not.",
      "TinyFish Search — free"],
     ["2 &nbsp;Search",
      "Query the resolved name against a first-party domain allowlist, then re-filter the results "
      "by host, because domain scoping is a ranking preference rather than a guarantee.",
      "TinyFish Search — free"],
     ["3 &nbsp;Parse snippets",
      "Extract candidate prices from the search snippets already in hand. Many lines finish here.",
      "Model call"],
     ["4 &nbsp;Fetch pages",
      "Only if the snippets yielded no price, or yielded a spread wide enough to be a conflict "
      "rather than a price. Up to three non-marketplace product pages, 10s cap.",
      "TinyFish Fetch — free"],
     ["5 &nbsp;Render",
      "Only if steps 3–4 produced <i>no price at all</i>. Firecrawl renders the page and returns "
      "structured product data.",
      "<b>Firecrawl — 1 credit</b>"],
     ["6 &nbsp;Decide",
      "Outlier filtering, pack-size and per-unit normalisation, seller checks, in-stock state, and "
      "a confidence grade. A line that cannot be priced is flagged as such rather than left blank.",
      "Free"]],
    [1.08*inch, 3.97*inch, 1.45*inch]))
A(Spacer(1, 7))
A(Paragraph(
  "The distinction the ladder turns on is that a lookup which <i>found nothing</i> is a different "
  "fact from one that <i>never ran</i>. Both produce an empty price, and they lead to opposite "
  "actions, so every call is recorded.", body))

# ── 4 ─────────────────────────────────────────────────────────────────────────
A(Paragraph("4 &nbsp; Why TinyFish", h2))
A(Paragraph(
  "TinyFish Search and Fetch carry the volume. Search is rate-limited at 30 requests per minute "
  "and Fetch at 150 URLs per minute per key, which is comfortably enough that a 300-line manifest "
  "fits inside a single call window at the ~2.6s a search actually takes. Both are free on the "
  "current tier, which is what makes a per-line lookup across a whole manifest viable at all.", body))
A(Paragraph("Two properties beyond price matter:", body))
A(Spacer(1, -3))
for b in bullets([
  "<b>Domain-scoped search.</b> Queries can be biased toward a first-party retailer allowlist, "
  "which is the difference between a shelf price and a marketplace reseller's markup.",
  "<b>Search doubles as identity resolution.</b> Searching a bare barcode returns one "
  "uncorroborated result. Searching the resolved product name returns ten, across five retailers, "
  "which gives the outlier filter something to work against."]):
    A(b)
A(Spacer(1, 5))
A(Paragraph(
  "TinyFish also exposes a metered browser-automation endpoint. It is deliberately not called. "
  "Lines that would require it are flagged and left unpriced, which is visible, rather than "
  "quietly billed.", body))

# ── 5 ─────────────────────────────────────────────────────────────────────────
A(Paragraph("5 &nbsp; Why Firecrawl", h2))
A(Paragraph(
  "Firecrawl is scoped to exactly the two places the free path measurably dies, and to nothing "
  "else.", body))
A(sub("5.1 &nbsp; JavaScript-walled pages",
  "A plain fetch of certain retailer product pages returns navigation chrome and no content after "
  "ten seconds. The page is real and the price is on it; it simply is not in the HTML that "
  "arrives. Firecrawl renders it."))
A(sub("5.2 &nbsp; Fetch-hostile sites",
  "Home Depot returns HTTP 403 to a plain fetch. Firecrawl's " + MONO % 'proxy: "auto"' + " retries "
  "through enhanced proxies at no credit surcharge. This matters disproportionately because the "
  "big-ticket categories — home improvement, appliances, consumer electronics — are both the most "
  "fetch-hostile and the ones where a wrong buy costs the most."))
A(sub("5.3 &nbsp; The structured product format — the actual reason",
  "The decisive advantage is not rendering, which several tools do. It is that "
  + MONO % 'formats: ["product"]' + " returns " + MONO % "price.amount" + " and "
  + MONO % "availability.inStock" + " as structured data. A rendered page therefore never has to "
  "pass through a language model to yield a price."))
A(Paragraph(
  "That removes an entire class of failure. Scraped markup routinely contains lone surrogates and "
  "control characters, which survive JSON serialisation and are then rejected by the model API as "
  "malformed — taking the whole request with it. On one 331-line run this accounted for roughly "
  "a third of all price parses failing, and those lines then read as \"no first-party price\" when "
  "the truth was that we never managed to ask. Structured extraction deletes that failure mode and "
  "a model call per line along with it.", body))
A(Spacer(1, 3))
A(KeepTogether([
  Paragraph("The request as sent:", body),
  codeblock([
    "POST https://api.firecrawl.dev/v2/scrape",
    "",
    "{",
    "  url,",
    '  formats:        ["product", "markdown"],',
    "  onlyMainContent: true,",
    '  proxy:          "auto",       // clears the 403-ing retailers',
    "  maxAge:         172800000,    // a two-day-old price is still the price",
    "  timeout:        30000,",
    '  location:       { country: "US", languages: ["en-US"] }',
    "}",
  ])]))
A(Spacer(1, 7))
A(Paragraph(
  MONO % "maxAge" + " is set to 48 hours on the view that a two-day-old shelf price is still the "
  "shelf price and costs less to serve. " + MONO % "markdown" + " is requested alongside "
  + MONO % "product" + " as a fallback: if the structured block is absent, the markdown still goes "
  "to the parser rather than wasting the credit.", body))

# ── 6 ─────────────────────────────────────────────────────────────────────────
A(Paragraph("6 &nbsp; Cost control and observability", h2))
A(Paragraph(
  "Firecrawl is the only call in this pipeline that costs money. Everything else is free at "
  "current tiers. That asymmetry drives four controls:", body))
A(Spacer(1, -3))
for b in bullets([
  "<b>It runs only after the free path has failed to produce a price.</b> The test is the presence "
  "of a price, not the size of the response — see finding 3 below.",
  "<b>Hard credit cap per batch.</b> Ten credits, which keeps a 331-line manifest inside the "
  "1,000/month free tier even if every eligible line escalates.",
  "<b>Every call is logged to D1</b> — provider, target, credits, success, HTTP status and "
  "latency — free calls included. This is what makes \"this manifest cost nothing\" a fact rather "
  "than an assumption. A credit is counted whether or not the scrape succeeded, because a failed "
  "scrape can still have been billed and a budget that only counts successes is not a budget.",
  "<b>A processing lock</b> prevents two scheduled runs from escalating the same line twice and "
  "spending two credits for one answer."]):
    A(b)

# ── 7 ─────────────────────────────────────────────────────────────────────────
A(Paragraph("7 &nbsp; Findings from production", h2))
A(Paragraph(
  "Every rule in the pipeline was written after a real lookup returned a wrong number. The ones "
  "most relevant to a tooling discussion:", body))
A(Spacer(1, 2))
A(datatable(
    ["#", "Finding", "Consequence"],
    [["1", "Searching a bare barcode returned a single result carrying no price. Searching the "
           "resolved product name returned ten, from five retailers — same product.",
           "Identity resolution became a mandatory first step. One uncheckable number became a "
           "cluster that can be sanity-checked against itself."],
     ["2", "A manifest written in plain language priced at roughly 80% coverage. One written in "
           "warehouse abbreviations priced at roughly 25% — with every search, fetch and parse "
           "succeeding technically and finding nothing.",
           "Abbreviation expansion is not an optimisation. Searching warehouse shorthand is a "
           "question nobody would ask out loud."],
     ["3", "Escalation was gated on response length — under 400 characters meant failure. A "
           "product page returned 820 characters of navigation furniture and no price, sailed "
           "past the test, and the renderer that would have worked never ran.",
           "The gate now tests for a price. Length was never the question."],
     ["4", "Domain-scoped search returned five results from domains outside the allowlist — and "
           "those were the only ones carrying prices in their snippets.",
           "Scoping is treated as a ranking preference. Results are re-filtered by host before "
           "use."],
     ["5", "A discount retailer's search snippets carried $20.35 for an item a national grocer "
           "sells at $2.39.",
           "A price that parses cleanly can still be wrong by an order of magnitude. "
           "Corroboration across retailers is not optional."],
     ["6", "A credit budget built with a coercion that yielded NaN compared false against every "
           "check, leaving the paid path effectively uncapped. The tell was a null in the "
           "response body the whole time.",
           "Found and fixed. It is also the clearest argument for logging every call: the log is "
           "what made an invisible failure visible."]],
    [0.3*inch, 3.15*inch, 3.05*inch]))

# ── 8 ─────────────────────────────────────────────────────────────────────────
A(Paragraph("8 &nbsp; Where we would expand", h2))
A(Paragraph(
  "Firecrawl is currently rationed for cost reasons rather than fit. Three expansions are already "
  "identified:", body))
A(Spacer(1, -3))
for b in bullets([
  "<b>Escalate on low confidence, not only on total failure.</b> Today a line reaches Firecrawl "
  "only when the free path returns nothing at all. A structured " + MONO % "price.amount" + " is "
  "materially more reliable than a model's reading of snippet text, so any line that currently "
  "resolves at low confidence is a candidate.",
  "<b>Big-ticket categories.</b> Home improvement, appliances and consumer electronics are the "
  "most fetch-hostile sources and carry the highest per-unit stakes. Lines in these categories "
  "that need heavier tooling are currently flagged and left unpriced entirely.",
  "<b>Price Scan latency.</b> The interactive path has a manager standing in an aisle. Skipping "
  "the free-then-fallback ladder in favour of going straight to structured data would trade "
  "credits for seconds — a trade currently unavailable to us."]):
    A(b)
A(Spacer(1, 5))
A(Paragraph(
  "The constraint on all three is the same: budget headroom on the one paid line in the pipeline. "
  "We would welcome a conversation about what expanded usage could look like.", body))

A(Spacer(1, 5))
A(KeepTogether([
  rule(space_after=4),
  Paragraph(
    "Prepared from the production integration in the Bargain Lane operator dashboard. "
    "Buy-criteria thresholds, internal pricing and sales figures are omitted by design; "
    "this covers integration architecture only.", foot)]))

# ── Build ─────────────────────────────────────────────────────────────────────
def decorate(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.6)
    canvas.setFillColor(DIM)
    canvas.drawString(1.0*inch, 0.58*inch,
                      "Bargain Lane · Retail Price Discovery — Firecrawl & TinyFish Integration")
    canvas.drawRightString(7.5*inch, 0.58*inch, "Page %d" % doc.page)
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(1.0*inch, 0.75*inch, 7.5*inch, 0.75*inch)
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=LETTER,
                      leftMargin=1.0*inch, rightMargin=1.0*inch,
                      topMargin=0.85*inch, bottomMargin=0.95*inch,
                      title="Retail Price Discovery — Firecrawl & TinyFish Integration",
                      author="Bargain Lane",
                      subject="Technical brief on the retail price lookup pipeline")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main",
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=decorate)])
doc.build(story)
print("wrote", OUT)
