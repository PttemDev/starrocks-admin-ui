import { useEffect } from 'react';
import { Select, Tag, Space } from 'antd';
import { useEnvStore } from '../../store/envStore';
import { fetchEnvironments } from '../../api/client';

export default function EnvSwitcher() {
  const { environments, selectedEnv, setEnvironments, setSelectedEnv } =
    useEnvStore();

  useEffect(() => {
    fetchEnvironments()
      .then(setEnvironments)
      .catch((err) => console.error('Failed to load environments:', err));
  }, [setEnvironments]);

  const currentEnv = environments.find((e) => e.name === selectedEnv);

  return (
    <Space size={8} align="center">
      <Select
        value={selectedEnv || undefined}
        onChange={setSelectedEnv}
        placeholder="Select environment"
        popupMatchSelectWidth={false}
        style={{
          minWidth: 160,
          background: 'rgba(255,255,255,0.08)',
          borderRadius: 8,
        }}
        className="sr-env-select"
        dropdownStyle={{ borderRadius: 8 }}
        options={environments.map((env) => ({
          value: env.name,
          label: (
            <Space size={6}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#10b981',
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 500 }}>{env.display_name}</span>
              {env.read_only && (
                <Tag
                  color="default"
                  style={{
                    fontSize: 10,
                    lineHeight: '16px',
                    padding: '0 4px',
                    borderRadius: 4,
                    margin: 0,
                  }}
                >
                  RO
                </Tag>
              )}
            </Space>
          ),
        }))}
        // Style the select text white for dark header
        labelRender={(props) => {
          const env = environments.find((e) => e.name === props.value);
          return (
            <Space size={6}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#10b981',
                  display: 'inline-block',
                }}
              />
              <span style={{ color: '#e2e8f0', fontWeight: 500 }}>
                {env?.display_name || String(props.value)}
              </span>
            </Space>
          );
        }}
      />
      {currentEnv?.read_only && (
        <Tag
          color="orange"
          style={{
            fontSize: 10,
            lineHeight: '18px',
            borderRadius: 4,
            margin: 0,
          }}
        >
          Read Only
        </Tag>
      )}
    </Space>
  );
}
