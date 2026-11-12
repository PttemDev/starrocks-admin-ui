import { useState, useRef } from 'react';
import { Tabs, Button, Tooltip } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { useQueryStore } from '../../store/queryStore';
import QueryTab from './QueryTab';
import TabLabel from './TabLabel';
import SchemaBrowser from './SchemaBrowser';
import QueryHistory from './QueryHistory';

export default function QueryConsole() {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab, moveTab } =
    useQueryStore();
  const [schemaOpen, setSchemaOpen] = useState(true);
  const dragId = useRef<string | null>(null);

  // Double clicking the strip of empty space after the last tab opens a new one,
  // the way editors do. Tabs and the "+" button handle their own clicks — a
  // double click on "+" would otherwise add three tabs.
  const handleBarDoubleClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (
      el.closest('.ant-tabs-nav-wrap') &&
      !el.closest('.ant-tabs-tab, .ant-tabs-nav-add, button')
    ) {
      addTab();
    }
  };

  return (
    <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 88px)' }}>
      {/* Schema browser panel — left side */}
      {schemaOpen && (
        <div
          className="sr-card"
          style={{
            width: 260,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <SchemaBrowser />
        </div>
      )}

      {/* Main query area */}
      <div
        className="sr-card"
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          padding: '12px 20px 20px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Tabs
          className="sr-query-tabs"
          type="editable-card"
          activeKey={activeTabId}
          onChange={setActiveTab}
          onEdit={(targetKey, action) => {
            if (action === 'add') addTab();
            if (action === 'remove') removeTab(targetKey as string);
          }}
          renderTabBar={(props, DefaultTabBar) => (
            <div onDoubleClick={handleBarDoubleClick} style={{ flexShrink: 0 }}>
              <DefaultTabBar {...props}>
                {(node) => (
                  <div
                    key={node.key}
                    draggable
                    onDragStart={(e) => {
                      // A drag started inside the rename input is a text
                      // selection, not a tab reorder.
                      if (document.activeElement?.tagName === 'INPUT') {
                        e.preventDefault();
                        return;
                      }
                      dragId.current = String(node.key);
                    }}
                    onDragEnd={() => { dragId.current = null; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragId.current) moveTab(dragId.current, String(node.key));
                      dragId.current = null;
                    }}
                    style={{ display: 'inline-flex' }}
                  >
                    {node}
                  </div>
                )}
              </DefaultTabBar>
            </div>
          )}
          tabBarExtraContent={{
            left: (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Tooltip title={schemaOpen ? 'Hide schema browser' : 'Show schema browser'}>
                  <Button
                    type="text"
                    icon={schemaOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
                    onClick={() => setSchemaOpen(!schemaOpen)}
                    size="small"
                    style={{ marginRight: 4 }}
                  />
                </Tooltip>
                <QueryHistory />
              </div>
            ),
          }}
          items={tabs.map((tab) => ({
            key: tab.id,
            label: <TabLabel id={tab.id} title={tab.title} />,
            children: <QueryTab tab={tab} />,
            closable: tabs.length > 1,
          }))}
        />
      </div>
    </div>
  );
}
