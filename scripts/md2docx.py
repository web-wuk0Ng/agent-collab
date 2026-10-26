# -*- coding: utf-8 -*-
"""把毕业设计 Markdown 文档批量转换为规范排版的 Word 文档。

用法：
    python scripts/md2docx.py                  # 转换 docs/毕业设计/ 下所有 md
    python scripts/md2docx.py <md文件或目录> <输出目录>

排版约定（毕业设计常用规范）：
    封面页：主标题、副标题、文档信息表、团队分工表、分页
    正文：一级标题(黑体三号)、二级标题(黑体小三)、三级标题(黑体四号)、正文(宋体小四，1.5 倍行距)
    表格：五号宋体，表头加粗并加底纹
    代码/示例：等宽字体、浅灰底纹
    页脚：居中页码
"""
import os
import re
import sys
import glob

from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

TEAM = [
    ("1（队长）", "王涛", "软工241", "202431990332", "架构与 Agent 运行时"),
    ("2", "谭绍卿", "软工241", "202431990331", "语音交互链路"),
    ("3", "夏艺凡", "软工242", "202431990132", "题库与知识库"),
    ("4", "覃佳维", "软工242", "20243190330", "前端交互与视觉"),
    ("5", "江帆帆", "软工242", "202431990320", "数据与测试部署"),
]

PROJECT = "面镜 MockMirror —— AI 模拟面试与能力提升软件"
SUBTITLE = "A11：AI 模拟面试与能力提升软件（锐捷网络）"
ORG = "浙江师范大学第 9 届大学生服务外包创新应用竞赛"


def set_run(run, name="宋体", size=12, bold=False, color=None, mono=False):
    run.font.size = Pt(size)
    run.bold = bold
    if color is not None:
        run.font.color.rgb = color
    fname = "Consolas" if mono else name
    run.font.name = fname
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), fname)
    rfonts.set(qn("w:hAnsi"), fname)
    rfonts.set(qn("w:eastAsia"), name if not mono else "宋体")


def shade(element, color="D9D9D9"):
    """给段落或单元格加底纹"""
    pr = element.get_or_add_tcPr() if element.tag.endswith("tc") else element.get_or_add_pPr()
    sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear")
    sh.set(qn("w:fill"), color)
    pr.append(sh)


INLINE = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")


def add_inline(p, text, size=12, base_font="宋体", color=None):
    """处理 **加粗** 与 `代码`"""
    if not text:
        return
    for seg in INLINE.split(text):
        if not seg:
            continue
        if seg.startswith("**") and seg.endswith("**") and len(seg) > 4:
            set_run(p.add_run(seg[2:-2]), base_font, size, True, color)
        elif seg.startswith("`") and seg.endswith("`") and len(seg) > 2:
            set_run(p.add_run(seg[1:-1]), base_font, size - 1, False, color, mono=True)
        else:
            set_run(p.add_run(seg), base_font, size, False, color)


def add_footer_page_number(doc):
    footer = doc.sections[0].footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run()
    set_run(r, size=9)
    for instr in ("begin", "separate", "end"):
        fld = OxmlElement("w:fldChar")
        fld.set(qn("w:fldCharType"), instr)
        r._r.append(fld)
        if instr == "separate":
            t = OxmlElement("w:instrText")
            t.set(qn("xml:space"), "preserve")
            t.text = " PAGE "
            r._r.append(t)


def build_cover(doc, title, meta_rows):
    """封面页"""
    for _ in range(4):
        doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run(ORG), "黑体", 14, True)
    doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run(PROJECT), "黑体", 22, True)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run(title), "黑体", 18, True)
    for _ in range(2):
        doc.add_paragraph()

    if meta_rows:
        t = doc.add_table(rows=len(meta_rows), cols=2)
        t.style = "Table Grid"
        t.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for i, (k, v) in enumerate(meta_rows):
            t.rows[i].cells[0].text = ""
            t.rows[i].cells[1].text = ""
            set_run(t.rows[i].cells[0].paragraphs[0].add_run(k), "黑体", 12, True)
            add_inline(t.rows[i].cells[1].paragraphs[0], v, 12)
            t.rows[i].cells[0].width = Cm(3.5)
            t.rows[i].cells[1].width = Cm(11)
        doc.add_paragraph()

    # 团队分工表
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run("项目组成员与分工"), "黑体", 13, True)
    t = doc.add_table(rows=len(TEAM) + 1, cols=5)
    t.style = "Table Grid"
    heads = ["序号", "姓名", "班级", "学号", "承担角色"]
    for j, h in enumerate(heads):
        cell = t.rows[0].cells[j]
        cell.text = ""
        set_run(cell.paragraphs[0].add_run(h), "黑体", 11, True)
        shade(cell._tc, "D9D9D9")
    for i, row in enumerate(TEAM, start=1):
        for j, val in enumerate(row):
            cell = t.rows[i].cells[j]
            cell.text = ""
            set_run(cell.paragraphs[0].add_run(val), "宋体", 11)
    doc.add_page_break()


def convert(md_path, out_dir):
    with open(md_path, "r", encoding="utf-8") as f:
        lines = f.read().split("\n")

    # 提取标题与元信息（文档开头的信息表）
    title = os.path.splitext(os.path.basename(md_path))[0]
    meta_rows = []
    in_meta = False
    body_start = 0
    for idx, line in enumerate(lines):
        if line.startswith("# "):
            title = line[2:].strip()
            body_start = idx + 1
            break
    # 首个表格作为封面信息表
    tbl = []
    for idx in range(body_start, min(body_start + 30, len(lines))):
        s = lines[idx].strip()
        if s.startswith("|"):
            tbl.append(idx)
        elif tbl and not s:
            break
    if tbl:
        for idx in tbl:
            cells = [c.strip() for c in lines[idx].strip().strip("|").split("|")]
            if len(cells) == 2 and set(cells[0]) - set("-: ") and cells[0] != "项目":
                if cells[1] and not set(cells[1]) <= set("-: "):
                    meta_rows.append((cells[0], cells[1]))
        body_start = tbl[-1] + 1
    meta_rows = meta_rows[:5]

    doc = Document()
    sec = doc.sections[0]
    sec.top_margin = Cm(2.5)
    sec.bottom_margin = Cm(2.5)
    sec.left_margin = Cm(3.0)
    sec.right_margin = Cm(3.0)
    add_footer_page_number(doc)
    build_cover(doc, title, meta_rows)

    i = body_start
    while i < len(lines):
        line = lines[i]
        s = line.strip()

        if not s or s == "---":
            i += 1
            continue

        # 代码块
        if s.startswith("```"):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.space_after = Pt(6)
            set_run(p.add_run("\n".join(buf)), "宋体", 10, mono=True)
            shade(p._p, "F2F2F2")
            continue

        # 表格
        if s.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            rows = [r for r in rows if not all(set(c) <= set("-: ") for c in r)]
            if not rows:
                continue
            ncol = max(len(r) for r in rows)
            t = doc.add_table(rows=len(rows), cols=ncol)
            t.style = "Table Grid"
            for ri, row in enumerate(rows):
                for ci in range(ncol):
                    val = row[ci] if ci < len(row) else ""
                    cell = t.rows[ri].cells[ci]
                    cell.text = ""
                    para = cell.paragraphs[0]
                    para.paragraph_format.space_after = Pt(2)
                    if ri == 0:
                        set_run(para.add_run(val.replace("**", "")), "黑体", 10.5, True)
                        shade(cell._tc, "D9D9D9")
                    else:
                        add_inline(para, val, 10.5)
            doc.add_paragraph()
            continue

        # 标题
        if s.startswith("#### "):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(8)
            set_run(p.add_run(s[5:].strip()), "黑体", 12, True)
            i += 1
            continue
        if s.startswith("### "):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(10)
            set_run(p.add_run(s[4:].strip()), "黑体", 13, True)
            i += 1
            continue
        if s.startswith("## "):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(12)
            set_run(p.add_run(s[3:].strip()), "黑体", 15, True)
            i += 1
            continue
        if s.startswith("# "):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(14)
            set_run(p.add_run(s[2:].strip()), "黑体", 16, True)
            i += 1
            continue

        # 引用
        if s.startswith(">"):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.8)
            add_inline(p, s.lstrip("> ").strip(), 11, color=RGBColor(0x59, 0x59, 0x59))
            i += 1
            continue

        # 列表
        m = re.match(r"^([-*]|\d+\.)\s+(.*)$", s)
        if m:
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.8)
            p.paragraph_format.space_after = Pt(3)
            marker = "• " if m.group(1) in ("-", "*") else m.group(1) + " "
            set_run(p.add_run(marker), "宋体", 12)
            add_inline(p, m.group(2), 12)
            i += 1
            continue

        # 正文
        p = doc.add_paragraph()
        p.paragraph_format.first_line_indent = Cm(0.74)
        p.paragraph_format.line_spacing = 1.5
        p.paragraph_format.space_after = Pt(4)
        add_inline(p, s, 12)
        i += 1

    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, os.path.splitext(os.path.basename(md_path))[0] + ".docx")
    doc.save(out)
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join("docs", "毕业设计")
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join("docs", "毕业设计", "Word版")

    if os.path.isdir(src):
        files = sorted(glob.glob(os.path.join(src, "*.md")))
    else:
        files = [src]
    for f in files:
        out = convert(f, out_dir)
        print("生成:", out)


if __name__ == "__main__":
    main()
