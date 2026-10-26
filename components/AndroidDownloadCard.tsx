import Image from 'next/image'
import { Download, QrCode } from 'lucide-react'

import { ANDROID_APP } from '@/lib/android-app'

/**
 * Public Android download card.
 *
 * Deliberately a plain presentational component: it has no Supabase or auth
 * dependency, so it renders for signed-out visitors on every page that mounts
 * it. The QR image is generated from ANDROID_APP.apkUrl (the direct public
 * object URL), not from the website URL.
 */
export default function AndroidDownloadCard() {
  const apkUrl = ANDROID_APP.apkUrl
  const available = typeof apkUrl === 'string' && apkUrl.length > 0

  const body = (
    <>
      <div className="p-3">
        <div className="flex items-center gap-3 px-0.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-white/10 bg-[#0e0f13] p-1">
            <Image
              src={ANDROID_APP.iconSrc}
              alt=""
              width={44}
              height={44}
              className="h-full w-full object-cover"
              unoptimized
            />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[17px] font-semibold leading-none tracking-tight text-white">
                {ANDROID_APP.name}
              </h3>
              <span className="shrink-0 rounded-[5px] border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9.5px] font-medium leading-none text-white/55">
                v{ANDROID_APP.version}
              </span>
            </div>
            <p className="mt-1.5 max-w-[100px] truncate font-mono text-[10.5px] leading-none tracking-tight text-white/40">
              {ANDROID_APP.packageName}
            </p>
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-[16px] bg-white p-3">
          {available ? (
            <Image
              src={ANDROID_APP.qrSrc}
              alt={`QR code to download the ${ANDROID_APP.name} Android app`}
              width={512}
              height={512}
              className="block h-auto w-full"
              unoptimized
              priority={false}
            />
          ) : (
            <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-[10px] bg-[#f4f5f7] px-4 text-center">
              <QrCode className="h-7 w-7 text-[#6b7280]" aria-hidden />
              <p className="text-[11px] font-medium leading-snug text-[#4b5563]">
                Android APK not published yet
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-white/10 bg-black/20 px-4 py-3 text-[11px] leading-none text-white/45">
        <QrCode className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          {available ? 'Point a phone at this to install' : 'Android download coming soon'}
        </span>
      </div>
    </>
  )

  const cardClass =
    'block overflow-hidden rounded-[22px] border border-white/[0.09] bg-[linear-gradient(180deg,#1e1f24_0%,#17181c_100%)] shadow-[0_24px_60px_-32px_rgba(0,0,0,0.95)]'

  return (
    <div className="mx-auto w-full max-w-[316px]">
      {available ? (
        <a
          href={apkUrl!}
          download
          aria-label={`Download ${ANDROID_APP.name} v${ANDROID_APP.version} for Android (.apk)`}
          className={`${cardClass} group transition-colors hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
        >
          {body}
        </a>
      ) : (
        <div className={cardClass}>{body}</div>
      )}

      {available ? (
        <a
          href={apkUrl!}
          download
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-[10px] border border-white/10 bg-[#191a1f] px-3 py-2.5 text-[12px] font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-[#202127] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Download for Android (.apk)
        </a>
      ) : (
        <span
          aria-disabled="true"
          className="mt-2.5 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-[10px] border border-white/10 bg-[#191a1f] px-3 py-2.5 text-[12px] font-medium text-white/40"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Download for Android (.apk) — coming soon
        </span>
      )}
    </div>
  )
}
