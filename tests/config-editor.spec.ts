import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fire, renderTest } from '@azerothjs/testing';

import ConfigEditor from '../src/features/configs/config-editor.component.azeroth';
import type { ProxyConfig } from '../src/lib/proxy/types';

/** A handler a test supplies only because the prop is required. */
const noop = (): void => undefined;

// The manual editor. Its whole job is to show the RIGHT fields for the protocol chosen -
// a form with twenty boxes is what makes NekoRay's dialog forbidding, and one with the
// wrong six silently builds a server that cannot connect.

const config = (): ProxyConfig => ({
    id: 'x',
    name: 'Demo',
    protocol: 'vless',
    host: 'a.example.invalid',
    port: 443,
    credential: '00000000-0000-4000-8000-000000000001',
    transport: 'tcp',
    security: 'tls',
    tags: [],
    favorite: false,
    allowInsecure: false,
    rawUri: '',
    addedAt: 0
} as unknown as ProxyConfig);

const open = (initial: ProxyConfig | null = null, onSubmit = noop): HTMLElement =>
    renderTest(() => ConfigEditor({
        open: () => true,
        initial: () => initial,
        onClose: noop,
        onSubmit
    })).container;

const labels = (root: HTMLElement): string[] =>
    [...root.querySelectorAll('span')].map((s) => s.textContent?.trim() ?? '');

const chip = (root: HTMLElement, text: string): HTMLButtonElement | undefined =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

const fill = (root: HTMLElement, index: number, value: string): void =>
{
    const field = [...root.querySelectorAll('input')][index];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

    setter.call(field, value);
    fire(field, 'input');
};

afterEach(() => cleanup());

describe('ConfigEditor', () =>
{
    it('renders nothing while closed', () =>
    {
        const container = renderTest(() => ConfigEditor({
            open: () => false, initial: () => null, onClose: noop, onSubmit: noop
        })).container;

        expect((container.textContent ?? '').trim()).toBe('');
    });

    it('offers every protocol the serialiser can actually write', () =>
    {
        // Offering one `build-uri.ts` cannot express would produce a server that saves and
        // then exports as something else.
        const container = open();

        for (const protocol of ['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'tuic'])
        {
            expect(chip(container, protocol), protocol).toBeDefined();
        }
    });

    it('prefills from the server being edited', () =>
    {
        const container = open(config());
        const values = [...container.querySelectorAll('input')].map((i) => i.value);

        expect(values).toContain('Demo');
        expect(values).toContain('a.example.invalid');
        expect(values).toContain('443');
    });

    it('opens blank for a new server rather than keeping the last one', () =>
    {
        const container = open(null);
        const values = [...container.querySelectorAll('input')].map((i) => i.value);

        expect(values).toContain('');
        expect(values).not.toContain('a.example.invalid');
    });

    it('asks shadowsocks for an encryption method, and nothing else for it', () =>
    {
        const container = open();

        expect(labels(container)).not.toContain('Encryption');

        fire(chip(container, 'shadowsocks')!, 'click');

        expect(labels(container)).toContain('Encryption');
        // Shadowsocks encrypts at the protocol layer; a TLS security row would be a lie.
        expect(labels(container)).not.toContain('SNI');
    });

    it('reveals the REALITY keys only when REALITY is chosen', () =>
    {
        const container = open();

        expect(labels(container)).not.toContain('Public key');

        fire(chip(container, 'reality')!, 'click');

        expect(labels(container)).toContain('Public key');
        expect(labels(container)).toContain('Short id');
    });

    it('hides the transport row for the QUIC-only protocols', () =>
    {
        const container = open();

        expect(chip(container, 'ws')).toBeDefined();

        fire(chip(container, 'hysteria2')!, 'click');

        expect(chip(container, 'ws'), 'hysteria2 is QUIC only').toBeUndefined();
    });

    it('keeps the advanced fields out of the way until asked', () =>
    {
        const container = open();

        expect(labels(container)).not.toContain('ALPN');

        fire([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Advanced')!, 'click');

        expect(labels(container)).toContain('ALPN');
    });

    it('refuses to save without a host and port', () =>
    {
        const container = open(null);
        const save = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement;

        expect(save.disabled, 'an empty form must not be savable').toBe(true);
    });

    it('rejects a host with a scheme or a space in it, the commonest paste mistake', () =>
    {
        const container = open(null);
        const save = (): HTMLButtonElement =>
            [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement;

        // Fields in order: name, host, port, credential.
        fill(container, 1, 'https://a.example.invalid');
        fill(container, 2, '443');

        expect(save().disabled).toBe(true);

        fill(container, 1, 'a.example.invalid');

        expect(save().disabled).toBe(false);
    });

    it('reports the whole draft on save', () =>
    {
        const onSubmit = vi.fn();
        const container = open(config(), onSubmit);
        const save = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save')!;

        fire(save, 'click');

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).toMatchObject({
            kind: 'form',
            values: { protocol: 'vless', host: 'a.example.invalid', port: '443' }
        });
    });
});

describe('ConfigEditor JSON tab', () =>
{
    const OUTBOUND = JSON.stringify({
        type: 'vless',
        tag: 'From JSON',
        server: 'json.example.invalid',
        server_port: 443,
        uuid: '00000000-0000-4000-8000-00000000000a'
    });

    const typeJson = (root: HTMLElement, text: string): void =>
    {
        const area = root.querySelector('textarea')!;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;

        setter.call(area, text);
        fire(area, 'input');
    };

    it('offers the JSON tab only when ADDING - editing already knows the fields', () =>
    {
        const adding = open(null);

        expect(chip(adding, 'JSON')).toBeDefined();

        cleanup();

        const editing = open(config());

        expect(chip(editing, 'JSON'), 'a JSON box is a worse way to change one known field').toBeUndefined();
    });

    it('turns a pasted outbound into a server', () =>
    {
        const onSubmit = vi.fn();
        const container = open(null, onSubmit);

        fire(chip(container, 'JSON')!, 'click');
        typeJson(container, OUTBOUND);
        fire([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save')!, 'click');

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).toMatchObject({ kind: 'uri' });
        expect(String((onSubmit.mock.calls[0][0] as { uri: string }).uri)).toContain('json.example.invalid');
    });

    it('accepts a whole profile as well as a bare outbound', () =>
    {
        const onSubmit = vi.fn();
        const container = open(null, onSubmit);

        fire(chip(container, 'JSON')!, 'click');
        typeJson(container, `{"outbounds":[${ OUTBOUND }]}`);
        fire([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save')!, 'click');

        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('says why rather than saving nothing when the JSON holds no server', () =>
    {
        const onSubmit = vi.fn();
        const container = open(null, onSubmit);

        fire(chip(container, 'JSON')!, 'click');
        typeJson(container, '{"nothing":true}');
        fire([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save')!, 'click');

        expect(onSubmit).not.toHaveBeenCalled();
        expect((container.textContent ?? '').length).toBeGreaterThan(0);
    });

    it('cannot be saved empty', () =>
    {
        const container = open(null);

        fire(chip(container, 'JSON')!, 'click');

        const save = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement;

        expect(save.disabled).toBe(true);
    });
});
