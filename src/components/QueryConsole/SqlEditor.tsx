import { useEffect, useRef, useState, useCallback } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { registerSqlCompletionProvider } from '../../utils/sqlCompletion';
import { useTheme } from '../../hooks/useTheme';

interface Props {
  value: string;
  onChange: (val: string) => void;
  onRun: () => void;
}

const MIN_HEIGHT = 100;
const DEFAULT_HEIGHT = 200;

function getMaxHeight() {
  return Math.round(window.innerHeight * 0.7);
}

let completionRegistered = false;

export default function SqlEditor({ value, onChange, onRun }: Props) {
  const { isDark } = useTheme();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  // Listen for insert events from schema browser
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      const ed = editorRef.current;
      if (!ed || !text) return;

      ed.focus();
      const selection = ed.getSelection();
      if (selection) {
        ed.executeEdits('sr-insert', [
          { range: selection, text, forceMoveMarkers: true },
        ]);
      }
    };

    window.addEventListener('sr-insert-sql', handler);
    return () => window.removeEventListener('sr-insert-sql', handler);
  }, []);

  // Drag-to-resize
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = height;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientY - startY.current;
      setHeight(Math.min(getMaxHeight(), Math.max(MIN_HEIGHT, startH.current + delta)));
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [height]);

  const handleBeforeMount = (monaco: Monaco) => {
    // Register completion provider only once globally
    if (!completionRegistered) {
      registerSqlCompletionProvider(monaco);
      completionRegistered = true;
    }
  };

  return (
    <div>
      <div className="sr-editor-wrapper">
        <Editor
          height={`${height}px`}
          language="sql"
          theme={isDark ? 'vs-dark' : 'vs-light'}
          value={value}
          onChange={(v) => onChange(v || '')}
          beforeMount={handleBeforeMount}
          onMount={(editor) => {
            editorRef.current = editor;
            // Ctrl/Cmd+Enter to run
            editor.addAction({
              id: 'run-query',
              label: 'Run Query',
              keybindings: [
                // Monaco KeyMod.CtrlCmd | Monaco KeyCode.Enter
                2048 | 3,
              ],
              run: () => onRun(),
            });
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, strings: false, comments: false },
            wordBasedSuggestions: 'off',
            padding: { top: 8, bottom: 8 },
            renderLineHighlight: 'line',
            lineDecorationsWidth: 8,
            folding: false,
            glyphMargin: false,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            scrollbar: {
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
            },
            suggest: {
              showKeywords: false, // We provide our own (with Constant kind)
              insertMode: 'replace',
              preview: true,
            },
          }}
        />
      </div>
      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        style={{
          height: 6,
          cursor: 'row-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '0 0 6px 6px',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sr-border)')}
        onMouseLeave={(e) => {
          if (!dragging.current) e.currentTarget.style.background = 'transparent';
        }}
      >
        <div
          style={{
            width: 32,
            height: 3,
            borderRadius: 2,
            background: 'var(--sr-text-faint)',
          }}
        />
      </div>
    </div>
  );
}
