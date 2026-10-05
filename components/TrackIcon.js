// Renders whatever a track's icon actually is — a short text/emoji tag, an
// icon-font class (e.g. Font Awesome), or an uploaded image — inside
// whatever badge/wrapper the caller already sizes and colors it with.
export default function TrackIcon({ track }) {
  const type = track.icon_type || 'tag';
  const value = track.icon;

  if (type === 'image' && value) {
    return <img src={value} alt="" className="track-icon-img" />;
  }
  if (type === 'class' && value) {
    return <i className={value} />;
  }
  return <>{value || '01'}</>;
}
