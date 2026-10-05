'use client';

import { useState } from 'react';
import { checkImei } from '@/lib/imei';
import MyDevices from './MyDevices';

// IMEI tab of the IP Locator. An IMEI can't be located by anyone but the
// mobile networks (for the police), so this checks the number and points to
// the official block-and-trace routes instead of pretending to find it.

export default function ImeiPanel() {
  const [value, setValue] = useState('');
  const [copied, setCopied] = useState(false);
  const result = checkImei(value);
  const imei = result?.ok ? result.parts.imei : '';
  const sms = imei ? `KYM ${imei}` : 'KYM <15-digit IMEI>';

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <>
      <MyDevices onUse={setValue} />

      <div className="tool-panel">
        <label className="field-label" htmlFor="ipl-imei">Check an IMEI</label>
        <input
          id="ipl-imei"
          className="input tool-mono"
          type="text"
          inputMode="numeric"
          placeholder="15 digits — dial *#06# on the phone, or check its box / bill"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={24}
        />
        {result && (
          <div className={`ipl-imei-check${result.ok ? ' ok' : ' bad'}`} role="status">
            <i className={`fa-solid ${result.ok ? 'fa-circle-check' : 'fa-circle-exclamation'}`} aria-hidden="true" /> {result.message}
          </div>
        )}
        {result?.ok && (
          <dl className="ipl-rows ipl-imei-parts">
            <div className="ipl-row"><dt>IMEI</dt><dd className="tool-mono">{result.parts.imei}</dd></div>
            <div className="ipl-row"><dt>TAC</dt><dd><span className="tool-mono">{result.parts.tac}</span> <span className="tool-muted">— identifies the make and model</span></dd></div>
            <div className="ipl-row"><dt>Serial</dt><dd className="tool-mono">{result.parts.serial}</dd></div>
            <div className="ipl-row"><dt>Check digit</dt><dd className="tool-mono">{result.parts.check}</dd></div>
          </dl>
        )}
        <p className="tool-muted ipl-hint">
          No website or app can show where a phone is from its IMEI — only mobile networks can trace it, and they do that for the police. Sites that promise
          “IMEI tracking” are scams. Use the official routes below.
        </p>
      </div>

      <div className="ipl-imei-ways">
        <div className="tool-panel">
          <h2><i className="fa-solid fa-shield-halved" aria-hidden="true" /> India — Sanchar Saathi (CEIR)</h2>
          <ol className="ipl-steps">
            <li>File a police complaint (FIR or online e-complaint) for the lost or stolen phone and keep the complaint number.</li>
            <li>Get a duplicate SIM for the lost number from your operator.</li>
            <li>
              On <a href="https://sancharsaathi.gov.in" target="_blank" rel="noopener noreferrer">sancharsaathi.gov.in</a> open <em>Block Your Lost/Stolen Mobile</em> and
              submit the IMEI{imei && <> (<span className="tool-mono">{imei}</span>)</>}, the complaint number and your phone’s purchase invoice.
            </li>
            <li>The phone is blocked on every Indian network. If anyone puts a SIM in it, the network traces it and the police are alerted.</li>
            <li>Got it back? Use <em>Unblock Found Mobile</em> on the same site.</li>
          </ol>
          <div className="ipl-kym">
            <div>
              <strong>Check an IMEI is genuine and not blacklisted</strong>
              <span className="tool-muted">SMS <span className="tool-mono">{sms}</span> to <span className="tool-mono">14422</span>, or use <em>Know Your Mobile</em> on Sanchar Saathi.</span>
            </div>
            {imei && (
              <button type="button" className="btn btn-sm" onClick={() => copy(sms)}>
                <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'}`} aria-hidden="true" /> {copied ? 'Copied' : 'Copy SMS'}
              </button>
            )}
          </div>
        </div>

        <div className="tool-panel">
          <h2><i className="fa-solid fa-location-crosshairs" aria-hidden="true" /> See it on a map</h2>
          <p className="ipl-text">
            A live location comes from the phone’s own account, not the IMEI — and only if it was switched on before the phone went missing.
          </p>
          <div className="tool-row">
            <a className="btn btn-sm" href="https://www.google.com/android/find" target="_blank" rel="noopener noreferrer">
              <i className="fa-brands fa-android" aria-hidden="true" /> Google Find My Device
            </a>
            <a className="btn btn-sm" href="https://www.icloud.com/find" target="_blank" rel="noopener noreferrer">
              <i className="fa-brands fa-apple" aria-hidden="true" /> Apple Find My
            </a>
          </div>
          <h2 className="ipl-h-gap"><i className="fa-solid fa-globe" aria-hidden="true" /> Outside India</h2>
          <p className="ipl-text">
            Report it to the police with the IMEI, then ask your mobile operator to blacklist it — most countries share a stolen-phone list through the GSMA, so it
            stops working on other networks too.
          </p>
        </div>
      </div>
    </>
  );
}
