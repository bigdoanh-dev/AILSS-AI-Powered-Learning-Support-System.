"""Build original AILSS lesson PDFs and text handouts. Requires reportlab and a Unicode TTF font."""
import json, os
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, PageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
root = Path(__file__).resolve().parent
font = os.environ.get('AILSS_PDF_FONT', '/System/Library/Fonts/Supplemental/Arial.ttf')
pdfmetrics.registerFont(TTFont('AILSS', font))
out = root / 'assets'
out.mkdir(exist_ok=True)
styles = {
 'title': ParagraphStyle('title', fontName='AILSS', fontSize=27, leading=35, textColor=colors.HexColor('#162f39'), spaceAfter=24),
 'h2': ParagraphStyle('h2', fontName='AILSS', fontSize=16, leading=23, textColor=colors.HexColor('#087f83'), spaceBefore=18, spaceAfter=10),
 'p': ParagraphStyle('p', fontName='AILSS', fontSize=11, leading=18, textColor=colors.HexColor('#334b55'), spaceAfter=12)
}
def footer(c, doc):
 c.setStrokeColor(colors.HexColor('#dce7e8')); c.line(48,48,547,48)
 c.setFillColor(colors.HexColor('#60717a')); c.setFont('AILSS',8)
 c.drawString(48,32,'AILSS | Học liệu minh họa tự biên soạn | Tiếng Việt')
 c.drawRightString(547,32,str(doc.page))
for item in json.loads((root/'courses.json').read_text()):
 doc=SimpleDocTemplate(str(out/(item['slug']+'.pdf')),pagesize=(595,842),leftMargin=48,rightMargin=48,topMargin=50,bottomMargin=68,title=item['title'],author='AILSS')
 flow=[Paragraph('AILSS / TÀI LIỆU BÀI GIẢNG',styles['h2']),Paragraph(escape(item['title']),styles['title']),Paragraph(escape(item['summary']),styles['p'])]
 for title,body in item['steps'][:2]: flow += [Paragraph(escape(title),styles['h2']),Paragraph(escape(body),styles['p'])]
 flow += [PageBreak(),Paragraph('Thực hành để hiểu sâu hơn',styles['title'])]
 for title,body in item['steps'][2:]: flow += [Paragraph(escape(title),styles['h2']),Paragraph(escape(body),styles['p'])]
 flow += [Paragraph('Bài tập thực hành',styles['h2']),Paragraph(escape(item['exercise']),styles['p']),Paragraph('Câu hỏi tự kiểm tra',styles['h2']),Paragraph(escape(item['question']),styles['p'])]
 for choice in item['options']: flow.append(Paragraph('• '+escape(choice),styles['p']))
 doc.build(flow,onFirstPage=footer,onLaterPages=footer)
 text=item['title']+'\n\n'+item['summary']+'\n\n'+'\n\n'.join(t+'\n'+b for t,b in item['steps'])+'\n\nBÀI TẬP\n'+item['exercise']+'\n\nCÂU HỎI\n'+item['question']+'\n'+'\n'.join(item['options'])+'\n'
 (out/(item['slug']+'.txt')).write_text(text)
 print(item['slug'])
