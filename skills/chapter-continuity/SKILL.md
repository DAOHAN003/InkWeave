---
name: chapter-continuity
description: 写正文、续写或改写章节时，核对前情、章纲、人物状态、时间地点和未回收伏笔。
version: 1.0.0
author: FuxiLoom
tags: [builtin, chapter_writing]
trigger_keywords: [写正文, 续写, 改写, 章节, 衔接, 前情]
task_types: [chapter_writing]
allowed_tools: [write_chapter, continue_writing, rewrite_chapter, modify_chapter_content, get_chapter_summaries]
tools_required: []
dependencies: []
prereq_env: []
prereq_commands: []
---

执行章节写作前，先核对当前卷纲、章纲、上一章末尾和当前章节已有内容。
列出本轮不可破坏的连续性锚点：人物位置、伤势、持有物、关系状态、时间与地点。
检查未回收伏笔，只在自然时机推进，不得无依据新增前情事实。
完成后自检首段承接、角色状态、时间推进和结尾钩子。
