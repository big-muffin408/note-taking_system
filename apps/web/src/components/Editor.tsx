import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import type * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';

interface EditorProps {
  content: string;
  onUpdate: (html: string) => void;
  editable?: boolean;
  insertRequest?: {
    id: number;
    html: string;
  } | null;
  collaboration?: {
    document: Y.Doc;
    provider: WebsocketProvider;
    user: {
      name: string;
      color: string;
    };
  };
  /** Called when the user selection changes. Passes the selected plain text (empty string when no selection). */
  onSelectionChange?: (text: string) => void;
  /** Extra controls rendered at the right end of the toolbar (e.g. polish button). */
  floatingToolbar?: React.ReactNode;
}

function hasMeaningfulContent(content: string) {
  const compact = content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim();
  return compact.length > 0 || /<(h[1-6]|ul|ol|li|blockquote|pre|img|hr)\b/i.test(content);
}

export default function Editor({ content, onUpdate, editable = true, insertRequest, collaboration, onSelectionChange, floatingToolbar }: EditorProps) {
  const initialized = useRef(false);
  const lastInsertRequest = useRef<number | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'code-block' } },
        history: collaboration ? false : undefined,
      }),
      Placeholder.configure({ placeholder: '开始编写笔记…' }),
      ...(collaboration
        ? [
            Collaboration.configure({
              document: collaboration.document,
            }),
            CollaborationCursor.configure({
              provider: collaboration.provider,
              user: collaboration.user,
            }),
          ]
        : []),
    ],
    content: collaboration ? undefined : content,
    editable,
    onUpdate: ({ editor }) => {
      onUpdate(editor.getHTML());
    },
    onSelectionUpdate: ({ editor }) => {
      if (!onSelectionChange) return;
      const { from, to } = editor.state.selection;
      const selectedText = from === to ? '' : editor.state.doc.textBetween(from, to, ' ');
      onSelectionChange(selectedText);
    },
  }, [collaboration?.document, collaboration?.provider]);

  // Update content when prop changes (e.g. loading from server)
  useEffect(() => {
    if (!editor || collaboration) return;

    if (content && !initialized.current) {
      editor.commands.setContent(content);
      initialized.current = true;
    }
  }, [editor, content, collaboration]);

  // Seed a brand-new collaborative Yjs document from the existing HTML once.
  useEffect(() => {
    if (!editor || !collaboration || !hasMeaningfulContent(content)) return;

    const seedIfEmpty = (synced: boolean) => {
      if (!synced || initialized.current || !editor.isEmpty) return;
      editor.commands.setContent(content, false);
      initialized.current = true;
      onUpdate(editor.getHTML());
    };

    collaboration.provider.on('synced', seedIfEmpty);
    seedIfEmpty(collaboration.provider.synced);

    return () => {
      collaboration.provider.off('synced', seedIfEmpty);
    };
  }, [editor, content, collaboration, onUpdate]);

  useEffect(() => {
    if (!editor || !insertRequest || lastInsertRequest.current === insertRequest.id) return;
    editor.chain().focus().insertContent(insertRequest.html).run();
    lastInsertRequest.current = insertRequest.id;
    onUpdate(editor.getHTML());
  }, [editor, insertRequest, onUpdate]);

  if (!editor) return null;

  return (
    <div className="editor-wrapper">
      <div className="editor-toolbar">
        <div className="toolbar-group">
          <button
            type="button"
            className={editor.isActive('heading', { level: 1 }) ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            title="标题 1"
          >
            H1
          </button>
          <button
            type="button"
            className={editor.isActive('heading', { level: 2 }) ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="标题 2"
          >
            H2
          </button>
          <button
            type="button"
            className={editor.isActive('heading', { level: 3 }) ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            title="标题 3"
          >
            H3
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button
            type="button"
            className={editor.isActive('bold') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="加粗 (Ctrl+B)"
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={editor.isActive('italic') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="斜体 (Ctrl+I)"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className={editor.isActive('strike') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="删除线"
          >
            <s>S</s>
          </button>
          <button
            type="button"
            className={editor.isActive('code') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleCode().run()}
            title="行内代码"
          >
            {'</>'}
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button
            type="button"
            className={editor.isActive('bulletList') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="无序列表"
          >
            •
          </button>
          <button
            type="button"
            className={editor.isActive('orderedList') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="有序列表"
          >
            1.
          </button>
          <button
            type="button"
            className={editor.isActive('blockquote') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="引用"
          >
            "
          </button>
          <button
            type="button"
            className={editor.isActive('codeBlock') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            title="代码块"
          >
            {'{ }'}
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button
            type="button"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="分割线"
          >
            ―
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="撤销 (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="重做 (Ctrl+Shift+Z)"
          >
            ↷
          </button>
        </div>
      </div>

      {floatingToolbar && (
        <div className="toolbar-floating-slot">
          {floatingToolbar}
        </div>
      )}

      <EditorContent editor={editor} className="editor-content" />
    </div>
  );
}
