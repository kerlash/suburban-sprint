export type PelotonPeer = {
  id: string;
  name: string;
  workoutId: string;
  power: number;
  distanceKm: number;
  sentAt: number;
};

export class LocalPeloton extends EventTarget {
  readonly id = crypto.randomUUID();
  private channel?: BroadcastChannel;
  private peers = new Map<string, PelotonPeer>();

  constructor() {
    super();
    if (!('BroadcastChannel' in window)) return;
    this.channel = new BroadcastChannel('suburban-sprint-peloton-v1');
    this.channel.addEventListener('message', event => {
      const peer = event.data as PelotonPeer;
      if (!peer || peer.id === this.id || typeof peer.power !== 'number') return;
      this.peers.set(peer.id, peer);
      this.pruneAndEmit();
    });
    window.setInterval(() => this.pruneAndEmit(), 1500);
  }

  publish(name: string, workoutId: string, power: number, distanceKm: number) {
    this.channel?.postMessage({ id: this.id, name, workoutId, power, distanceKm, sentAt: Date.now() } satisfies PelotonPeer);
  }

  private pruneAndEmit() {
    const cutoff = Date.now() - 4000;
    for (const [id, peer] of this.peers) if (peer.sentAt < cutoff) this.peers.delete(id);
    this.dispatchEvent(new CustomEvent<PelotonPeer[]>('peers', { detail: [...this.peers.values()] }));
  }
}
