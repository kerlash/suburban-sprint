export type Telemetry = {
  power: number;
  cadence: number;
  heartRate: number;
  trainerName?: string;
  hrName?: string;
};

interface GattCharacteristicLike extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<GattCharacteristicLike>;
  writeValue?(value: BufferSource): Promise<void>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
}

interface GattServiceLike {
  getCharacteristic(id: number): Promise<GattCharacteristicLike>;
}

interface GattServerLike {
  getPrimaryService(id: number): Promise<GattServiceLike>;
}

interface BluetoothDeviceLike extends EventTarget {
  name?: string;
  gatt?: { connect(): Promise<GattServerLike> };
}

type BluetoothLike = Navigator & {
  bluetooth?: {
    requestDevice(options: unknown): Promise<BluetoothDeviceLike>;
  };
};

const FTMS = 0x1826;
const INDOOR_BIKE_DATA = 0x2ad2;
const FITNESS_MACHINE_CONTROL_POINT = 0x2ad9;
const CYCLING_POWER = 0x1818;
const CYCLING_POWER_MEASUREMENT = 0x2a63;
const HEART_RATE = 0x180d;
const HEART_RATE_MEASUREMENT = 0x2a37;

export class SensorHub extends EventTarget {
  readonly data: Telemetry = { power: 0, cadence: 0, heartRate: 0 };
  demoEnabled = true;
  private demoStartedAt = performance.now();
  private controlPoint?: GattCharacteristicLike;
  private controlPending?: { opcode: number; resolve: () => void; reject: (error: Error) => void; timer: number };
  controlEnabled = false;

  get trainerControlAvailable() { return Boolean(this.controlPoint); }

  private changed() {
    this.dispatchEvent(new CustomEvent<Telemetry>('telemetry', { detail: { ...this.data } }));
  }

  private bluetooth() {
    const bluetooth = (navigator as BluetoothLike).bluetooth;
    if (!bluetooth) throw new Error('Web Bluetooth is unavailable. Use current Chrome or Edge on Windows.');
    return bluetooth;
  }

  async connectTrainer() {
    const device = await this.bluetooth().requestDevice({
      filters: [{ services: [FTMS] }, { services: [CYCLING_POWER] }],
      optionalServices: [FTMS, CYCLING_POWER]
    });
    const server = await device.gatt?.connect();
    if (!server) throw new Error('The trainer did not expose a Bluetooth GATT server.');

    try {
      const service = await server.getPrimaryService(FTMS);
      const characteristic = await service.getCharacteristic(INDOOR_BIKE_DATA);
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', (event: Event) => {
        const value = (event.target as GattCharacteristicLike).value;
        if (value) this.parseIndoorBikeData(value);
      });
      try { this.controlPoint = await service.getCharacteristic(FITNESS_MACHINE_CONTROL_POINT); }
      catch { this.controlPoint = undefined; }
    } catch {
      const service = await server.getPrimaryService(CYCLING_POWER);
      const characteristic = await service.getCharacteristic(CYCLING_POWER_MEASUREMENT);
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', (event: Event) => {
        const value = (event.target as GattCharacteristicLike).value;
        if (value) this.data.power = Math.max(0, value.getInt16(2, true));
        this.changed();
      });
    }
    const trainerName = device.name || 'Trainer';
    this.data.trainerName = trainerName;
    this.demoEnabled = false;
    this.changed();
    device.addEventListener('gattserverdisconnected', () => {
      this.data.trainerName = undefined;
      this.data.power = 0;
      this.data.cadence = 0;
      this.controlPoint = undefined;
      this.controlEnabled = false;
      this.changed();
    });
    return trainerName;
  }

  async enableTrainerControl() {
    const point = this.controlPoint;
    if (!point) throw new Error('This trainer did not advertise FTMS power control. Telemetry still works normally.');
    await point.startNotifications();
    point.addEventListener('characteristicvaluechanged', this.onControlResponse);
    await this.controlCommand(new Uint8Array([0x00]));
    this.controlEnabled = true;
    this.dispatchEvent(new CustomEvent('controlstatus', { detail: 'ERG control enabled.' }));
  }

  async disableTrainerControl() {
    if (this.controlEnabled) {
      try { await this.controlCommand(new Uint8Array([0x01])); }
      catch { /* Releasing local control still prevents further targets if reset is unsupported. */ }
    }
    this.controlEnabled = false;
    this.dispatchEvent(new CustomEvent('controlstatus', { detail: 'ERG control released. Trainer telemetry remains connected.' }));
  }

  async setTargetPower(watts: number) {
    if (!this.controlEnabled) return;
    const target = Math.max(0, Math.min(2000, Math.round(watts)));
    const bytes = new Uint8Array(3);
    bytes[0] = 0x05;
    new DataView(bytes.buffer).setInt16(1, target, true);
    await this.controlCommand(bytes);
  }

  private onControlResponse = (event: Event) => {
    const value = (event.target as GattCharacteristicLike).value;
    if (!value || value.byteLength < 3 || value.getUint8(0) !== 0x80) return;
    const requestOpcode = value.getUint8(1), result = value.getUint8(2), pending = this.controlPending;
    if (!pending || pending.opcode !== requestOpcode) return;
    window.clearTimeout(pending.timer);
    this.controlPending = undefined;
    if (result === 0x01) pending.resolve();
    else pending.reject(new Error(`Trainer rejected control command 0x${requestOpcode.toString(16)} (result 0x${result.toString(16)}).`));
  };

  private controlCommand(bytes: Uint8Array) {
    const point = this.controlPoint;
    if (!point) return Promise.reject(new Error('Trainer control is unavailable.'));
    if (this.controlPending) return Promise.reject(new Error('Trainer control command already in progress.'));
    return new Promise<void>(async (resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (this.controlPending?.opcode === bytes[0]) this.controlPending = undefined;
        reject(new Error('Trainer did not acknowledge the control command.'));
      }, 3000);
      this.controlPending = { opcode: bytes[0], resolve, reject, timer };
      try {
        const payload = new Uint8Array(bytes).buffer as ArrayBuffer;
        if (point.writeValueWithResponse) await point.writeValueWithResponse(payload);
        else if (point.writeValue) await point.writeValue(payload);
        else throw new Error('Browser cannot write to the trainer control characteristic.');
      } catch (error) {
        window.clearTimeout(timer);
        this.controlPending = undefined;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async connectHeartRate() {
    const device = await this.bluetooth().requestDevice({ filters: [{ services: [HEART_RATE] }] });
    const server = await device.gatt?.connect();
    if (!server) throw new Error('The heart-rate sensor did not expose a Bluetooth GATT server.');
    const service = await server.getPrimaryService(HEART_RATE);
    const characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', (event: Event) => {
      const value = (event.target as GattCharacteristicLike).value;
      if (!value) return;
      this.data.heartRate = value.getUint8(0) & 1 ? value.getUint16(1, true) : value.getUint8(1);
      this.changed();
    });
    const hrName = device.name || 'Heart-rate sensor';
    this.data.hrName = hrName;
    this.changed();
    device.addEventListener('gattserverdisconnected', () => {
      this.data.hrName = undefined;
      this.data.heartRate = 0;
      this.changed();
    });
    return hrName;
  }

  updateDemo(now: number) {
    if (!this.demoEnabled || this.data.trainerName) return;
    const t = (now - this.demoStartedAt) / 1000;
    const interval = Math.floor(t / 18) % 3;
    const targets = [145, 235, 175];
    this.data.power = Math.round(targets[interval] + Math.sin(t * 1.7) * 12 + Math.sin(t * 0.31) * 8);
    this.data.cadence = Math.round(82 + interval * 4 + Math.sin(t * 1.2) * 3);
    if (!this.data.hrName) this.data.heartRate = Math.round(125 + interval * 12 + Math.sin(t * 0.16) * 5);
    this.changed();
  }

  private parseIndoorBikeData(value: DataView) {
    const flags = value.getUint16(0, true);
    let offset = 2;
    if ((flags & 1) === 0) offset += 2; // instantaneous speed
    if (flags & (1 << 1)) offset += 2;
    if (flags & (1 << 2)) { this.data.cadence = value.getUint16(offset, true) / 2; offset += 2; }
    if (flags & (1 << 3)) offset += 2;
    if (flags & (1 << 4)) offset += 3;
    if (flags & (1 << 5)) offset += 2;
    if (flags & (1 << 6)) { this.data.power = Math.max(0, value.getInt16(offset, true)); offset += 2; }
    if (flags & (1 << 7)) offset += 2;
    if (flags & (1 << 8)) offset += 5;
    if (flags & (1 << 9)) this.data.heartRate = value.getUint8(offset);
    this.changed();
  }
}
