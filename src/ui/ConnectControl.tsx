import { useEffect, useState } from 'react';
import { useApp, useStoreSelector } from '../app/context';
import { Icon } from './Icon';

/** Connect / disconnect the live Arduino. Only ever acts on an explicit click. */
export function ConnectControl() {
  const { services } = useApp();
  const { store, session } = services.live;
  const status = useStoreSelector(store, (s) => s.link.status);
  const error = useStoreSelector(store, (s) => s.link.error);
  const [known, setKnown] = useState(false);

  useEffect(() => {
    if (status === 'disconnected') void session.transport.hasKnownPort().then(setKnown);
  }, [status, session]);

  if (status === 'unsupported') {
    return (
      <div className="connect">
        <button className="btn btn-primary" disabled title={error ?? undefined}>
          <Icon name="usb" /> Connect Arduino
        </button>
      </div>
    );
  }
  if (status === 'connected') {
    return (
      <div className="connect">
        <button className="btn btn-quiet" onClick={() => void session.disconnect()}>
          <Icon name="unplug" /> Disconnect
        </button>
      </div>
    );
  }
  const busy = status === 'connecting' || status === 'disconnecting';
  return (
    <div className="connect">
      {known && !busy && (
        <button className="btn btn-quiet" onClick={() => void session.connect(false)} title="Reopen the port used last time">
          <Icon name="refresh" /> Reconnect
        </button>
      )}
      <button className="btn btn-primary" disabled={busy} onClick={() => void session.connect(true)}>
        <Icon name="usb" /> {busy ? 'Connecting…' : 'Connect Arduino'}
      </button>
    </div>
  );
}
