import React, { useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { MathematicsDisplayMode } from '../lib/MathematicsDisplayMode';
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
  /** Increment this to force the editor to re-read the content prop (e.g. after version restore). */
  contentKey?: number;
  /** Called when the user selects an image file. Should upload and return the image URL. */
  onImageUpload?: (file: File) => Promise<string>;
}

function hasMeaningfulContent(content: string) {
  const compact = content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim();
  return compact.length > 0 || /<(h[1-6]|ul|ol|li|blockquote|pre|img|hr)\b/i.test(content);
}

export default function Editor({ content, onUpdate, editable = true, insertRequest, collaboration, onSelectionChange, floatingToolbar, contentKey, onImageUpload }: EditorProps) {
  const initialized = useRef(false);
  const lastInsertRequest = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'code-block' } },
        history: collaboration ? false : undefined,
      }),
      Placeholder.configure({ placeholder: '开始编写笔记…' }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      MathematicsDisplayMode.configure({
        regex: /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g,
        katexOptions: {
          throwOnError: false,
        },
      }),
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

  const handleImageFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImageUpload || !editor) return;
    e.target.value = '';
    try {
      const url = await onImageUpload(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      console.error('Image upload failed:', err);
    }
  }, [onImageUpload, editor]);

  const insertMathBlock = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().insertContent('$$\n\n$$').run();
  }, [editor]);

  // Update content when prop changes (e.g. loading from server)
  useEffect(() => {
    if (!editor || collaboration) return;

    if (content && !initialized.current) {
      editor.commands.setContent(content);
      initialized.current = true;
    }
  }, [editor, content, collaboration]);

  // Reset initialization when contentKey changes (e.g. after version restore)
  useEffect(() => {
    if (contentKey !== undefined && editor) {
      initialized.current = false;
      editor.commands.setContent(content);
      initialized.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

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

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            title="插入图片"
          >
            🖼
          </button>
          <button
            type="button"
            onClick={insertMathBlock}
            title="插入数学公式"
          >
            ∑
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            title="插入表格"
          >
            ⊞
          </button>
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleImageFileChange}
        />
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
