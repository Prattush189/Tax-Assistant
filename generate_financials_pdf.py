"""
Generate comprehensive Smart AI Tax Assistant Financial Report PDF
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, Image
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from datetime import datetime

OUTPUT = "Smart_AI_Financial_Report.pdf"

# ── Colors (warm emerald theme matching the app) ──
EMERALD = colors.HexColor("#0D9668")
EMERALD_DARK = colors.HexColor("#0A7B55")
EMERALD_LIGHT = colors.HexColor("#EDFCF5")
WARM_DARK = colors.HexColor("#252220")
WARM_GRAY = colors.HexColor("#5C5750")
WARM_LIGHT = colors.HexColor("#F3F1EE")
GOLD = colors.HexColor("#B8860B")
RED = colors.HexColor("#DC2626")

# ── Setup document ──
doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    leftMargin=1.5 * cm,
    rightMargin=1.5 * cm,
    topMargin=1.8 * cm,
    bottomMargin=1.8 * cm,
    title="Smart AI Tax Assistant - Financial Report",
    author="Smart AI",
)

styles = getSampleStyleSheet()

# Custom styles
title_style = ParagraphStyle(
    'CustomTitle',
    parent=styles['Title'],
    fontSize=22,
    textColor=EMERALD_DARK,
    spaceAfter=6,
    alignment=TA_CENTER,
    fontName='Helvetica-Bold',
)

subtitle_style = ParagraphStyle(
    'Subtitle',
    parent=styles['Normal'],
    fontSize=11,
    textColor=WARM_GRAY,
    alignment=TA_CENTER,
    spaceAfter=20,
)

h1_style = ParagraphStyle(
    'H1',
    parent=styles['Heading1'],
    fontSize=16,
    textColor=EMERALD_DARK,
    spaceBefore=18,
    spaceAfter=10,
    fontName='Helvetica-Bold',
)

h2_style = ParagraphStyle(
    'H2',
    parent=styles['Heading2'],
    fontSize=13,
    textColor=WARM_DARK,
    spaceBefore=14,
    spaceAfter=8,
    fontName='Helvetica-Bold',
)

body_style = ParagraphStyle(
    'Body',
    parent=styles['Normal'],
    fontSize=10,
    textColor=WARM_DARK,
    spaceAfter=8,
    leading=14,
)

small_style = ParagraphStyle(
    'Small',
    parent=styles['Normal'],
    fontSize=8,
    textColor=WARM_GRAY,
    alignment=TA_CENTER,
    spaceAfter=4,
)

callout_style = ParagraphStyle(
    'Callout',
    parent=styles['Normal'],
    fontSize=10,
    textColor=EMERALD_DARK,
    fontName='Helvetica-Bold',
    spaceAfter=8,
)

story = []

# ── Cover / Header ──
story.append(Paragraph("Smart AI Tax Assistant", title_style))
story.append(Paragraph("Financial Analysis &amp; Cost Report", subtitle_style))
story.append(Paragraph(
    f"Generated: {datetime.now().strftime('%d %B %Y')}<br/>"
    f"Conversion rate used: 1 USD = ₹92.61",
    small_style
))
story.append(Spacer(1, 8 * mm))

# Divider
divider = Table([['']], colWidths=[17*cm], rowHeights=[2])
divider.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), EMERALD)]))
story.append(divider)
story.append(Spacer(1, 8 * mm))

# ── Executive Summary ──
story.append(Paragraph("Executive Summary", h1_style))
story.append(Paragraph(
    "This report provides a complete financial breakdown of the Smart AI Tax Assistant SaaS platform, "
    "including per-operation API costs, monthly cost per user across all plans, revenue projections, "
    "and profit margin analysis. All costs are calculated based on Grok 4.1 Fast API pricing.",
    body_style
))

# Summary table
summary_data = [
    ['Metric', 'Free', 'Pro', 'Enterprise'],
    ['Monthly Price (INR)', '₹0', '₹499 – ₹799', '₹4,999 – ₹9,999'],
    ['Max API Cost/user/mo', '₹23.77', '₹158.70', '₹1,498.28'],
    ['Realistic Cost (40%)', '₹9.51', '₹63.48', '₹599.31'],
    ['Profit at ₹499/₹4999', '–₹9.51', '₹435.52', '₹4,399.69'],
    ['Profit Margin', 'Loss leader', '~87%', '~88%'],
]

summary_table = Table(summary_data, colWidths=[4.5*cm, 3.5*cm, 4*cm, 5*cm])
summary_table.setStyle(TableStyle([
    # Header
    ('BACKGROUND', (0, 0), (-1, 0), EMERALD),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, 0), 10),
    ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
    ('VALIGN', (0, 0), (-1, 0), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, 0), 8),
    ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
    # Body
    ('FONTSIZE', (0, 1), (-1, -1), 9),
    ('TEXTCOLOR', (0, 1), (-1, -1), WARM_DARK),
    ('ALIGN', (1, 1), (-1, -1), 'CENTER'),
    ('ALIGN', (0, 1), (0, -1), 'LEFT'),
    ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
    ('TOPPADDING', (0, 1), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, WARM_LIGHT]),
]))
story.append(summary_table)
story.append(Spacer(1, 6 * mm))

# ── Per-Operation Cost Breakdown ──
story.append(PageBreak())
story.append(Paragraph("1. Per-Operation API Cost Breakdown", h1_style))
story.append(Paragraph(
    "The platform uses <b>Grok 4.1 Fast</b> for all AI operations. Pricing: "
    "<b>$0.20/1M input tokens</b>, <b>$0.50/1M output tokens</b>, "
    "and <b>$0.005 per web search call</b>.",
    body_style
))

story.append(Paragraph("1.1 Standard Chat Message", h2_style))
chat_data = [
    ['Component', 'Tokens', 'Cost (USD)', 'Cost (INR)'],
    ['System prompt', '~320', '$0.000064', '₹0.0059'],
    ['RAG context (3 chunks)', '~940', '$0.000188', '₹0.0174'],
    ['Chat history (6 msgs)', '~450', '$0.000090', '₹0.0083'],
    ['User message', '~20', '$0.000004', '₹0.0004'],
    ['Response output', '~750', '$0.000375', '₹0.0347'],
    ['Total per message', '~2,480', '$0.000721', '₹0.0668'],
]
chat_table = Table(chat_data, colWidths=[6*cm, 3*cm, 4*cm, 4*cm])
chat_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), EMERALD),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ('ALIGN', (0, 0), (0, -1), 'LEFT'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
    ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, WARM_LIGHT]),
    # Highlight total row
    ('BACKGROUND', (0, -1), (-1, -1), EMERALD_LIGHT),
    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
]))
story.append(chat_table)
story.append(Spacer(1, 6 * mm))

story.append(Paragraph("1.2 Other Operations", h2_style))
ops_data = [
    ['Operation', 'Input tokens', 'Output tokens', 'Cost (INR)'],
    ['Document upload (PDF/image)', '~2,000', '~200', '₹0.046'],
    ['Notice draft generation', '~4,500', '~2,750', '₹0.211'],
    ['AI investment suggestion', '~500', '~800', '₹0.046'],
    ['Web search call', '—', '—', '₹0.463'],
]
ops_table = Table(ops_data, colWidths=[6*cm, 3.5*cm, 3.5*cm, 4*cm])
ops_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), EMERALD),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ('ALIGN', (0, 0), (0, -1), 'LEFT'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, WARM_LIGHT]),
]))
story.append(ops_table)

# ── Plan-Level Cost Analysis ──
story.append(PageBreak())
story.append(Paragraph("2. Monthly Cost Per User by Plan", h1_style))
story.append(Paragraph(
    "Breakdown of maximum API costs when a user fully utilizes their monthly allowance. "
    "Realistic costs are typically <b>30-50%</b> of these maximums.",
    body_style
))

# Free Plan
story.append(Paragraph("2.1 Free Plan", h2_style))
story.append(Paragraph(
    "Limits: 10 messages/day (300/month), 1 attachment/message, "
    "50 AI suggestions/month, 1 saved profile",
    body_style
))
free_data = [
    ['Item', 'Volume', 'Unit Cost', 'Total'],
    ['Chat messages', '300', '₹0.067', '₹20.08'],
    ['Document uploads (~10%)', '30', '₹0.046', '₹1.39'],
    ['AI suggestions', '50', '₹0.046', '₹2.30'],
    ['Total Max Cost', '', '', '₹23.77'],
]
free_table = Table(free_data, colWidths=[6*cm, 2.5*cm, 3*cm, 3.5*cm])
free_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), WARM_GRAY),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ('ALIGN', (0, 0), (0, -1), 'LEFT'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
    ('BACKGROUND', (0, -1), (-1, -1), EMERALD_LIGHT),
    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
]))
story.append(free_table)
story.append(Spacer(1, 5 * mm))

# Pro Plan
story.append(Paragraph("2.2 Pro Plan", h2_style))
story.append(Paragraph(
    "Limits: 1,000 messages/month, 3 attachments/message, web search, "
    "200 AI suggestions/month, 10 saved profiles, 30 notice drafts/month",
    body_style
))
pro_data = [
    ['Item', 'Volume', 'Unit Cost', 'Total'],
    ['Chat messages', '1,000', '₹0.067', '₹66.68'],
    ['Web search (~15%)', '150', '₹0.463', '₹69.46'],
    ['Document uploads (~15%)', '150', '₹0.046', '₹6.95'],
    ['Notice drafts', '30', '₹0.211', '₹6.34'],
    ['AI suggestions', '200', '₹0.046', '₹9.26'],
    ['Total Max Cost', '', '', '₹158.70'],
]
pro_table = Table(pro_data, colWidths=[6*cm, 2.5*cm, 3*cm, 3.5*cm])
pro_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), EMERALD),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ('ALIGN', (0, 0), (0, -1), 'LEFT'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
    ('BACKGROUND', (0, -1), (-1, -1), EMERALD_LIGHT),
    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
]))
story.append(pro_table)
story.append(Spacer(1, 5 * mm))

# Enterprise Plan
story.append(Paragraph("2.3 Enterprise Plan", h2_style))
story.append(Paragraph(
    "Limits: 10,000 messages/month, 5 attachments/message, "
    "1,000 AI suggestions/month, 50 saved profiles, 100 notice drafts/month",
    body_style
))
ent_data = [
    ['Item', 'Volume', 'Unit Cost', 'Total'],
    ['Chat messages', '10,000', '₹0.067', '₹666.79'],
    ['Web search (~15%)', '1,500', '₹0.463', '₹694.58'],
    ['Document uploads (~15%)', '1,500', '₹0.046', '₹69.46'],
    ['Notice drafts', '100', '₹0.211', '₹21.14'],
    ['AI suggestions', '1,000', '₹0.046', '₹46.31'],
    ['Total Max Cost', '', '', '₹1,498.28'],
]
ent_table = Table(ent_data, colWidths=[6*cm, 2.5*cm, 3*cm, 3.5*cm])
ent_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#4F46E5")),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ('ALIGN', (0, 0), (0, -1), 'LEFT'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
    ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor("#EEF2FF")),
    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
]))
story.append(ent_table)

# ── Cost Drivers ──
story.append(PageBreak())
story.append(Paragraph("3. Cost Drivers Analysis", h1_style))
story.append(Paragraph(
    "Understanding which features drive the most cost helps with optimization and pricing decisions.",
    body_style
))

driver_data = [
    ['Cost Driver', 'Free %', 'Pro %', 'Enterprise %'],
    ['Chat messages', '84.5%', '42.0%', '44.5%'],
    ['Web search', '0.0%', '43.8%', '46.4%'],
    ['Document uploads', '5.8%', '4.4%', '4.6%'],
    ['AI suggestions', '9.7%', '5.8%', '3.1%'],
    ['Notice drafts', '0.0%', '4.0%', '1.4%'],
]
driver_table = Table(driver_data, colWidths=[5*cm, 3.5*cm, 3.5*cm, 4*cm])
driver_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), EMERALD),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ('ALIGN', (0, 0), (0, -1), 'LEFT'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, WARM_LIGHT]),
]))
story.append(driver_table)
story.append(Spacer(1, 6 * mm))

story.append(Paragraph(
    "<b>Key Insight:</b> Web search is the dominant cost driver for Pro and Enterprise plans "
    "(~44-46% of total cost). At ₹0.463 per call, even 15% trigger rate nearly matches the "
    "entire chat generation cost. Consider tightening web search trigger patterns or caching "
    "common queries to reduce costs.",
    callout_style
))

# ── Revenue Projections ──
story.append(Paragraph("4. Revenue Projections &amp; Unit Economics", h1_style))
story.append(Paragraph(
    "Projected revenue and profit at different user counts, assuming realistic "
    "40% utilization of plan limits.",
    body_style
))

story.append(Paragraph("4.1 Suggested Pricing (INR/month)", h2_style))
pricing_data = [
    ['Plan', 'Price (INR)', 'Max Cost', 'Realistic Cost (40%)', 'Profit @ 40%'],
    ['Free', '₹0', '₹23.77', '₹9.51', '–₹9.51'],
    ['Pro', '₹499', '₹158.70', '₹63.48', '₹435.52'],
    ['Pro (Higher)', '₹799', '₹158.70', '₹63.48', '₹735.52'],
    ['Enterprise', '₹4,999', '₹1,498.28', '₹599.31', '₹4,399.69'],
    ['Enterprise (Higher)', '₹9,999', '₹1,498.28', '₹599.31', '₹9,399.69'],
]
pricing_table = Table(pricing_data, colWidths=[3.5*cm, 2.8*cm, 2.8*cm, 4*cm, 3.9*cm])
pricing_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), EMERALD),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ('ALIGN', (0, 0), (0, -1), 'LEFT'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, WARM_LIGHT]),
    ('TEXTCOLOR', (-1, 1), (-1, 1), RED),  # Free loss
    ('TEXTCOLOR', (-1, 2), (-1, -1), EMERALD_DARK),  # Profits
    ('FONTNAME', (-1, 1), (-1, -1), 'Helvetica-Bold'),
]))
story.append(pricing_table)
story.append(Spacer(1, 6 * mm))

story.append(Paragraph("4.2 Revenue Projections @ 1,000 Users", h2_style))
story.append(Paragraph(
    "Example scale: 1,000 total users with a realistic tier distribution "
    "(80% Free, 15% Pro, 5% Enterprise).",
    body_style
))

proj_data = [
    ['Metric', 'Free', 'Pro', 'Enterprise', 'Total'],
    ['User Count', '800', '150', '50', '1,000'],
    ['Revenue/mo', '₹0', '₹74,850', '₹249,950', '₹324,800'],
    ['API Cost/mo', '₹7,608', '₹9,522', '₹29,966', '₹47,096'],
    ['Gross Profit/mo', '-₹7,608', '₹65,328', '₹219,984', '₹277,704'],
    ['Profit Margin', '—', '87.3%', '88.0%', '85.5%'],
]
proj_table = Table(proj_data, colWidths=[3.8*cm, 2.8*cm, 3*cm, 3.5*cm, 3.5*cm])
proj_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), EMERALD),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ('ALIGN', (0, 0), (0, -1), 'LEFT'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
    ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, WARM_LIGHT]),
    ('BACKGROUND', (0, -1), (-1, -1), EMERALD_LIGHT),
    ('FONTNAME', (0, -2), (-1, -2), 'Helvetica-Bold'),
    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
]))
story.append(proj_table)
story.append(Spacer(1, 6 * mm))

# Highlighted total
highlight_data = [
    ['Annual Revenue Projection (1,000 users)', '₹38,97,600'],
    ['Annual API Cost', '₹5,65,152'],
    ['Annual Gross Profit', '₹33,32,448'],
    ['Overall Profit Margin', '85.5%'],
]
highlight_table = Table(highlight_data, colWidths=[11*cm, 6*cm])
highlight_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, -1), EMERALD_LIGHT),
    ('TEXTCOLOR', (0, 0), (-1, -1), EMERALD_DARK),
    ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 11),
    ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
    ('ALIGN', (0, 0), (0, -1), 'LEFT'),
    ('TOPPADDING', (0, 0), (-1, -1), 10),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ('LEFTPADDING', (0, 0), (-1, -1), 15),
    ('RIGHTPADDING', (0, 0), (-1, -1), 15),
    ('LINEBELOW', (0, 0), (-1, -2), 0.5, colors.white),
]))
story.append(highlight_table)

# ── Plan Comparison ──
story.append(PageBreak())
story.append(Paragraph("5. Plan Feature Comparison", h1_style))
story.append(Paragraph(
    "Complete feature matrix across all three subscription tiers.",
    body_style
))

feature_data = [
    ['Feature', 'Free', 'Pro', 'Enterprise'],
    ['Chat Messages', '10/day', '1,000/mo', '10,000/mo'],
    ['Attachments per Message', '1', '3', '5'],
    ['Live Web Search', '✗', '✓', '✓'],
    ['Tax Calculators', '✓', '✓', '✓'],
    ['Document Analysis', '✓', '✓', '✓'],
    ['PDF References (Acts)', '✓', '✓', '✓'],
    ['Saved Tax Profiles', '1', '10', '50'],
    ['Reference Profiles in Chat', '✗', '✓', '✓'],
    ['AI Investment Suggestions', '50/mo', '200/mo', '1,000/mo'],
    ['Salary Optimizer', '✗', '✓', '✓'],
    ['PDF Export', '✗', '✓', '✓'],
    ['Notice Drafting', '3/mo', '30/mo', '100/mo'],
    ['Priority Support', '—', 'Email', 'Dedicated'],
    ['Plugin/API Access', '✗', '✗', '✓'],
    ['Multi-user Teams', '✗', '✗', '✓'],
]

feature_table = Table(feature_data, colWidths=[5.5*cm, 3.5*cm, 3.5*cm, 4.5*cm])
feature_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), EMERALD),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ('ALIGN', (0, 0), (0, -1), 'LEFT'),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, WARM_LIGHT]),
]))
story.append(feature_table)

# ── Key Observations ──
story.append(PageBreak())
story.append(Paragraph("6. Key Observations &amp; Recommendations", h1_style))

obs = [
    ("Extremely Healthy Margins",
     "At realistic 40% utilization, both Pro and Enterprise plans show <b>~87-88% gross "
     "profit margins</b>. This is exceptional for a SaaS business and allows for significant "
     "investment in growth, marketing, and infrastructure."),
    ("Web Search is the Cost Bottleneck",
     "Web search accounts for <b>~44% of Pro</b> and <b>~46% of Enterprise</b> costs. "
     "Consider caching common queries or tightening trigger patterns (e.g., only activate "
     "for 'budget', 'CBDT circular', 'latest notification' instead of any year mention)."),
    ("Free Plan as Acquisition Funnel",
     "At ₹23.77 max cost per user, the Free plan costs only <b>~₹9.51 realistically</b>. "
     "With 800 free users, the monthly loss is <b>₹7,608</b> — easily covered by just "
     "17 Pro conversions at ₹499/mo."),
    ("Break-Even Point",
     "At 1,000 users (80/15/5 split), the platform generates <b>₹38.97 Lakh annual revenue</b> "
     "against <b>₹5.65 Lakh API costs</b>. Break-even after infrastructure/hosting is reached "
     "at approximately <b>50-75 paying users</b>."),
    ("Enterprise Tier Upsell Opportunity",
     "The 10x price jump (₹499 → ₹4,999) is justified by 10x usage limits + multi-user teams "
     "+ API access + dedicated support. CA firms serving multiple clients are the primary "
     "target market for Enterprise."),
]

for title, desc in obs:
    story.append(Paragraph(f"<b>• {title}</b>", callout_style))
    story.append(Paragraph(desc, body_style))

# ── Assumptions & Methodology ──
story.append(PageBreak())
story.append(Paragraph("7. Assumptions &amp; Methodology", h1_style))

story.append(Paragraph("7.1 Pricing Source", h2_style))
story.append(Paragraph(
    "All API costs are calculated using <b>xAI Grok 4.1 Fast</b> published rates "
    "(as of April 2026): input $0.20/1M tokens, output $0.50/1M tokens, "
    "web search $0.005/call. Currency conversion: 1 USD = ₹92.61.",
    body_style
))

story.append(Paragraph("7.2 Usage Assumptions", h2_style))
assumption_data = [
    ['Assumption', 'Value'],
    ['Web search trigger rate', '15% of queries'],
    ['Document upload rate', '10-15% of messages'],
    ['AI suggestions per user/month', 'Within plan limit'],
    ['Realistic plan utilization', '40% of max'],
    ['User tier distribution', '80% Free / 15% Pro / 5% Enterprise'],
    ['System prompt size', '~320 tokens'],
    ['RAG context size', '3 chunks × ~313 tokens = ~940 tokens'],
    ['Chat history window', 'Last 10 messages (~450 tokens avg)'],
    ['Average response size', '~750 tokens'],
]
assumption_table = Table(assumption_data, colWidths=[10*cm, 7*cm])
assumption_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), EMERALD),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('ALIGN', (0, 0), (0, -1), 'LEFT'),
    ('ALIGN', (1, 0), (1, -1), 'LEFT'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, WARM_LIGHT]),
]))
story.append(assumption_table)
story.append(Spacer(1, 6 * mm))

story.append(Paragraph("7.3 Not Included in This Analysis", h2_style))
story.append(Paragraph(
    "• Server hosting and infrastructure costs (~₹5,000-15,000/month for small scale)<br/>"
    "• Database and storage costs<br/>"
    "• Development and maintenance salaries<br/>"
    "• Marketing and customer acquisition costs<br/>"
    "• Payment processing fees (~2-3% of revenue)<br/>"
    "• GST (18%) on subscription revenue<br/>"
    "• Customer support staffing<br/>"
    "• Third-party integrations (Google OAuth, etc.)",
    body_style
))

# Footer on last page
story.append(Spacer(1, 15 * mm))
divider2 = Table([['']], colWidths=[17*cm], rowHeights=[2])
divider2.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), EMERALD)]))
story.append(divider2)
story.append(Spacer(1, 4 * mm))
story.append(Paragraph(
    "<b>Smart AI Tax Assistant</b> — Financial Analysis Report<br/>"
    f"Generated on {datetime.now().strftime('%d %B %Y at %I:%M %p IST')}<br/>"
    "Powered by Grok 4.1 Fast | Built with React, TypeScript, SQLite, Express<br/>"
    "This is an internal report. All figures are estimates based on published API pricing.",
    small_style
))

# Build PDF
doc.build(story)
print(f"Generated: {OUTPUT}")
