"""Hand-maintained table of US tariffs in force, mapped to HS chapters.
Every row carries a legal basis, an official source link, an 'as of' date and how it was checked.
Rates are ADDITIONAL duties on top of normal (MFN) duties unless a note says otherwise.
Run build.py to write it to site/data/current_us.json.
"""

AS_OF = "2026-11-18"

EU27 = ["AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA", "DEU", "GRC", "HUN", "IRL",
        "ITA", "LVA", "LTU", "LUX", "MLT", "NLD", "POL", "PRT", "ROU", "SVK", "SVN", "ESP", "SWE"]

FL_10 = ["ARG", "BGD", "KHM", "CAN", "ECU", "SLV", "GTM", "HND", "IND", "IDN", "JOR", "MYS", "MEX", "PAK",
         "LKA", "TTO", "GBR"]
FL_125 = ["DZA", "AGO", "AUS", "BHS", "BHR", "BRA", "CHL", "CHN", "COL", "CRI", "DOM", "EGY", "GUY", "HKG",
          "IRQ", "ISR", "KAZ", "KWT", "LBY", "MAR", "NZL", "NIC", "NGA", "NOR", "OMN", "PER", "PHL", "QAT",
          "RUS", "SAU", "SGP", "ZAF", "THA", "TUR", "ARE", "URY", "VEN", "VNM"]
CAP_10 = EU27 + ["TWN"]
CAP_125 = ["JPN", "KOR", "CHE"]

# Chapters handled by Section 232 or exempted from the forced-labour 301 duty as whole chapters
# (energy 27, pharmaceuticals 30, aircraft 88; 232 metals 72-74, 76; vehicles 87).
FL_EXCLUDE = ["27", "30", "72", "73", "74", "76", "87", "88"]
# Listed products exempt inside other chapters; their import values are pulled separately and netted out.
FL_EXEMPT_HS = {"0901": "Coffee", "1801": "Cocoa beans", "7108": "Gold", "847130": "Laptops",
                "851713": "Smartphones", "8542": "Integrated circuits"}

CHINA_301 = 21.3  # see s301-china note
MFN_TW = 2.2   # US trade-weighted average MFN tariff, 2024 (WTO Tariff & Trade Data)
CAR_MFN = 2.5  # US MFN on passenger cars (CRS IF12082)

FR = "https://www.federalregister.gov/documents/"
SRC_301FL = FR + "2026/07/28/2026-15181/notice-of-actions-in-section-301-investigations-of-acts-policies-and-practices-of-various-economies"
SRC_METALS = FR + "2026/04/09/2026-06960/strengthening-actions-taken-to-adjust-imports-of-aluminum-steel-and-copper-into-the-united-states"
SRC_COPPER = FR + "2025/08/05/2025-14893/adjusting-imports-of-copper-into-the-united-states"
SRC_AUTOS = FR + "2025/04/03/2025-05930/adjusting-imports-of-automobiles-and-automobile-parts-into-the-united-states"
SRC_UK = FR + "2025/06/23/2025-11473/implementing-the-general-terms-of-the-united-states-of-america-united-kingdom-economic-prosperity-deal"
SRC_TRUCKS = FR + "2025/10/22/2025-19639/adjusting-imports-of-medium--and-heavy-duty-vehicles-medium--and-heavy-duty-vehicle-parts-and-buses"
SRC_CHINA = "https://ustr.gov/issue-areas/enforcement/section-301-investigations/tariff-actions"
SRC_PIIE = "https://www.piie.com/blogs/trade-and-investment-policy-watch/2019/phase-one-china-deal-steep-tariffs-are-new-normal"
SRC_BRAZIL = "https://www.federalregister.gov/d/2026-14542"
SRC_WTO = "https://ttd.wto.org/en/profiles/united-states-of-america"
SRC_USMCA_MX = "https://www.everycrsreport.com/files/2026-08-13_IF11175_366b72c3fd2f3ebe10b28bf3feddca0088251bbb.html"
SRC_USMCA_CA = "https://www.everycrsreport.com/files/2026-09-16_IF12595_52ad24e6793eee59eeedf2a4ac39fbdfa23840ec.pdf"
SRC_AUTO_EFF = "https://www.carscoops.com/2025/11/automakers-are-paying-the-price-for-not-knowing-whats-inside-their-cars/"
SRC_METALS_WH = "https://www.whitehouse.gov/fact-sheets/2026/04/fact-sheet-president-donald-j-trump-strengthens-tariffs-on-steel-aluminum-and-copper-imports/"
SRC_BRAZIL_USTR = "https://ustr.gov/about/policy-offices/press-office/press-releases/2026/july/ustr-section-301-action-brazils-unreasonable-acts-policies-and-practices"
SRC_JAPAN = "https://www.whitehouse.gov/presidential-actions/2025/09/implementing-the-united-states-japan-agreement/"
SRC_KOREA = "https://www.govinfo.gov/content/pkg/FR-2025-12-04/pdf/2025-21940.pdf"
SRC_EU = "https://www.federalregister.gov/d/2025-18660"
SRC_CRS_CHINA = "https://www.congress.gov/crs-product/IF12990"
SRC_CRS_CHINA_FEB = "https://www.everycrsreport.com/files/2026-02-26_IF12990_7ab2239b1490ef7489dd800010ce8bc03b33701e.html"

CHECK_SECONDARY = ("Each row's 'verified' field says what it was checked against. Federal Register pages could not be fetched "
                   "from the build workspace; where the official text was read, it was via the White House, USTR, govinfo or CRS.")

# scope "product": a Section 232 product tariff. A country-wide scenario line leaves these in place.
# scope "country": a country-wide layer. A country-wide scenario line replaces these.
LINES = [
    # ---------------- Section 232 (product tariffs, all countries) ----------------
    dict(id="s232-metals", layer="Section 232", scope="product", label="Steel, aluminium, copper", targets="ALL",
         products=["72", "73", "74", "76"], rate=50,
         basis="Section 232, Proclamation 11021: 50% on the full value of articles made (almost) entirely of the metals, from 6 Apr 2026",
         note="Derivative articles pay 25%; modelled at 50% for the whole chapter, which overstates chapter 73 (steel articles).",
         source=SRC_METALS_WH, source2=SRC_METALS, effective="2026-04-06",
         verified="Verified: White House fact sheet on Proclamation 11021 (50% articles, 25% derivatives, UK 25%/15%)."),
    dict(id="s232-metals-uk", layer="Section 232", scope="product", label="Steel, aluminium, copper — UK", targets=["GBR"],
         products=["72", "73", "74", "76"], rate=25, basis="Section 232, UK rate for articles made almost entirely of the metals",
         note="UK derivatives pay 15%; modelled at 25%.", source=SRC_METALS_WH, effective="2026-04-06",
         verified="Verified: White House fact sheet on Proclamation 11021."),
    dict(id="s232-autos", layer="Section 232", scope="product", label="Vehicles & parts", targets="ALL", products=["87"], rate=25,
         basis="Section 232, Proclamation 10908 (cars Apr 2025, parts May 2025); trucks Proclamation 10984 (Nov 2025)",
         note="Buses (10%) and non-covered items in chapter 87 are modelled at 25%.",
         source=SRC_AUTOS, source2=SRC_TRUCKS, effective="2025-04-03",
         verified="Verified: White House fact sheet on Proclamation 10908 (25%); CRS IF12990 (trucks 25%, buses 10%)."),
    dict(id="s232-autos-deal", layer="Section 232", scope="product", label="Vehicles & parts — EU, Japan, Korea",
         targets=EU27 + ["JPN", "KOR"], products=["87"], rate=15 - CAR_MFN,
         basis="Section 232 deal rate: Column 1 (MFN) duty plus the 232 duty totals 15%",
         note="Modelled as 15% minus the 2.5% car MFN = 12.5% additional.", source=SRC_JAPAN, source2=SRC_KOREA, effective="2025-09-16",
         verified="Verified for Japan (EO 14345 text, White House) and Korea (Federal Register notice 2025-21940, govinfo). EU: same structure per notice 2025-18660, text not read."),
    dict(id="s232-autos-uk", layer="Section 232", scope="product", label="Vehicles — UK (quota)", targets=["GBR"], products=["87"],
         rate=7.5, basis="Section 232, EO 14309: 7.5% within a 100,000-vehicle quota",
         note="Quota limits ignored.", source=SRC_UK, effective="2025-06-30",
         verified="UNVERIFIED: from secondary summaries only; official text not read."),
    dict(id="s232-autos-usmca", layer="Section 232", scope="product", label="Vehicles & parts — Mexico, Canada", targets=["MEX", "CAN"],
         products=["87"], rate=25, coverage=0.76,
         basis="Section 232: USMCA vehicles pay 25% on non-US content only",
         note="Coverage 0.76 reproduces the ~19% average tariff reported on cars from Canada and Mexico (USITC data via TD Cowen, Jul 2025).",
         source=SRC_AUTOS, source2=SRC_AUTO_EFF, effective="2025-04-03",
         verified="UNVERIFIED estimate: the 25%-on-non-US-content rule is official; the 0.76 coverage comes from a press report of an analyst's calculation."),

    # ---------------- Section 301 forced-labour action (60 economies) ----------------
    dict(id="s301fl-10", layer="Section 301 forced labour", scope="country", label="Forced-labour 301 — 10% tier", targets=FL_10,
         products="ALL", exclude_products=FL_EXCLUDE, rate=10, exempt_ref="fl_exempt",
         coverage={"MEX": 0.12, "CAN": 0.15},
         basis="Section 301, 91 FR 47318 (effective 24 Jul 2026); replaced the Section 122 10% surcharge",
         note="USMCA goods are exempt. Coverage = 12% of Mexico (88% USMCA-compliant Jan–May 2026, CRS IF11175) and 15% of Canada (CRS IF12595: duties applied to about 15% of 2025 imports from Canada by value, including 232 goods, so an upper bound).",
         source=SRC_301FL, source2=SRC_USMCA_MX, effective="2026-07-24",
         verified="Rates cross-checked against several law-firm and trade-data summaries; Mexico and Canada coverage from CRS (IF11175, IF12595)."),
    dict(id="s301fl-125", layer="Section 301 forced labour", scope="country", label="Forced-labour 301 — 12.5% tier", targets=FL_125,
         products="ALL", exclude_products=FL_EXCLUDE, rate=12.5, exempt_ref="fl_exempt",
         basis="Section 301, 91 FR 47318", note="", source=SRC_301FL, effective="2026-07-24",
         verified="Cross-checked against several summaries; China's 12.5% also in CRS IF12990."),
    dict(id="s301fl-cap10", layer="Section 301 forced labour", scope="country", label="Forced-labour 301 — EU & Taiwan (10% cap incl. MFN)",
         targets=CAP_10, products="ALL", exclude_products=FL_EXCLUDE, rate=round(10 - MFN_TW, 1), exempt_ref="fl_exempt",
         basis="Section 301, 91 FR 47318: tops the MFN rate up to 10%",
         note="Modelled as 10% minus the 2.2% US trade-weighted MFN average (WTO) = 7.8%.",
         source=SRC_301FL, source2=SRC_WTO, effective="2026-07-24", verified="Cross-checked against several summaries."),
    dict(id="s301fl-cap125", layer="Section 301 forced labour", scope="country", label="Forced-labour 301 — Japan, Korea, Switzerland (12.5% cap incl. MFN)",
         targets=CAP_125, products="ALL", exclude_products=FL_EXCLUDE, rate=round(12.5 - MFN_TW, 1), exempt_ref="fl_exempt",
         basis="Section 301, 91 FR 47318: tops the MFN rate up to 12.5%",
         note="Modelled as 12.5% minus 2.2% = 10.3%.", source=SRC_301FL, source2=SRC_WTO, effective="2026-07-24",
         verified="Cross-checked against several summaries."),

    # ---------------- Country-specific 301 actions (stack on top) ----------------
    dict(id="s301-china", layer="Section 301 China (2018, 2024)", scope="country", label="China 301 (Lists 1–4A and 2024 increases)", targets=["CHN"],
         products="ALL", rate=CHINA_301,
         basis="Section 301 China actions: Lists 1–3 at 25%, List 4A at 7.5% (2018–19), plus the May 2024 increases of 25–100% on EVs, batteries, semiconductors, solar cells, steel, aluminium, medical products and cranes",
         note=("Modelled as one average of 21.3 points, derived from CRS IF12990: its trade-weighted US average on China was 34% in Feb 2026 "
               "with the 10% Section 122 surcharge in force, minus that 10% and the 2.7% pre-war average (CRS, 2017) = 21.3. "
               "Check: 21.3 + 12.5 (forced-labour 301) + 2.7 = 36.5%, CRS's July 2026 figure. Ignores product exclusions."),
         source=SRC_CHINA, source2=SRC_CRS_CHINA, effective="2018-07-06",
         verified="Derived from CRS IF12990 (official Congressional research), Feb and Jul 2026 editions."),
    dict(id="s301-brazil", layer="Section 301 Brazil", scope="country", label="Brazil 301 (25%)", targets=["BRA"], products="ALL",
         exclude_products=FL_EXCLUDE, rate=25, exempt_ref="fl_exempt",
         basis="Section 301 Brazil action (USTR, 15 Jul 2026; effective 22 Jul 2026), on top of the 12.5% forced-labour duty",
         note="Excludes Section 232 goods; Brazil's own exemptions (agriculture, aerospace, pharmaceuticals, energy and more) are approximated by the forced-labour exemptions.",
         source=SRC_BRAZIL_USTR, source2=SRC_BRAZIL, effective="2026-07-22",
         verified="Verified: USTR press release (25% on certain goods of Brazil). Effective date from trade press."),
]

NOT_MODELLED = [
    ("Canada Section 338 duties (50% on three product lists, since 22 Aug 2026)", "Listed products only; not mappable to whole chapters."),
    ("Section 232 patented pharmaceuticals (100%; 15% for EU, Japan, Korea, Switzerland)", "Generics excluded; patented share of chapter 30 unknown."),
    ("Section 232 semiconductors (25% on advanced chips, broad end-use exceptions)", "Small, hard-to-measure slice of chapter 85."),
    ("Section 232 lumber (10%), upholstered furniture and kitchen cabinets (25%)", "Part of chapters 44 and 94 only."),
    ("Section 232 drones (25–100%) and polysilicon (from 4 Dec 2026)", "Narrow products."),
    ("Russia, Belarus, Cuba, North Korea: Column 2 (non-normal-trade) rates", "Base-rate change, not an additional duty."),
    ("Normal MFN duties, antidumping and countervailing duties", "The table shows additional duties only."),
]

SOURCES_CHECKED = CHECK_SECONDARY
