import { useState, useRef, useEffect } from 'react';
import { Dropdown, Input } from 'antd';
import type { InputRef } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import {
  EditOutlined,
  CopyOutlined,
  CloseOutlined,
  ColumnWidthOutlined,
  VerticalRightOutlined,
} from '@ant-design/icons';
import { useQueryStore } from '../../store/queryStore';

interface Props {
  id: string;
  title: string;
}

/**
 * Tab label with in-place rename (double click) and a right-click menu.
 * The tab bar's own drag/close handling stays intact — rename swaps the label
 * for an input rather than replacing the tab node.
 */
export default function TabLabel({ id, title }: Props) {
  const tabs = useQueryStore((s) => s.tabs);
  const renameTab = useQueryStore((s) => s.renameTab);
  const duplicateTab = useQueryStore((s) => s.duplicateTab);
  const removeTab = useQueryStore((s) => s.removeTab);
  const closeOtherTabs = useQueryStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useQueryStore((s) => s.closeTabsToRight);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEdit = () => {
    setDraft(title);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== title) renameTab(id, draft);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        size="small"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        // The tab bar would otherwise steal the click and switch/close tabs.
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        autoFocus
        style={{ width: Math.max(90, title.length * 8 + 24), height: 22 }}
      />
    );
  }

  const idx = tabs.findIndex((t) => t.id === id);
  const isLast = idx === tabs.length - 1;
  const onlyTab = tabs.length <= 1;

  const items: ItemType[] = [
    { key: 'rename', icon: <EditOutlined />, label: 'Rename' },
    { key: 'duplicate', icon: <CopyOutlined />, label: 'Duplicate' },
    { type: 'divider' },
    { key: 'close', icon: <CloseOutlined />, label: 'Close', disabled: onlyTab },
    {
      key: 'closeOthers',
      icon: <ColumnWidthOutlined />,
      label: 'Close others',
      disabled: onlyTab,
    },
    {
      key: 'closeRight',
      icon: <VerticalRightOutlined />,
      label: 'Close to the right',
      disabled: isLast,
    },
  ];

  const onMenuClick = (key: string) => {
    if (key === 'rename') startEdit();
    else if (key === 'duplicate') duplicateTab(id);
    else if (key === 'close') removeTab(id);
    else if (key === 'closeOthers') closeOtherTabs(id);
    else if (key === 'closeRight') closeTabsToRight(id);
  };

  return (
    <Dropdown
      trigger={['contextMenu']}
      menu={{ items, onClick: ({ key }) => onMenuClick(key) }}
    >
      <span onDoubleClick={startEdit} style={{ userSelect: 'none' }}>
        {title}
      </span>
    </Dropdown>
  );
}
