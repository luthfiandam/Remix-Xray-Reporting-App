import React, { useState, useEffect } from 'react';
import { fetchAuthenticatedImageBlob } from '../utils/evidenceUtils';
import { extractS3ObjectKey } from '../utils/s3ObjectKey';

interface S3ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string;
  fallbackSrc?: string;
}

export const S3Image: React.FC<S3ImageProps> = ({
  src,
  fallbackSrc,
  alt = '',
  className = '',
  ...props
}) => {
  const [imgSrc, setImgSrc] = useState<string>('');
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    // Do not show a stale photo from the previous report while a new key loads.
    setImgSrc('');
    setHasError(false);
    if (!src) {
      setImgSrc(fallbackSrc || '');
      return;
    }

    if (src.startsWith('data:') || src.startsWith('blob:')) {
      setImgSrc(src);
      setHasError(false);
      return;
    }

    const key = extractS3ObjectKey(src);

    fetchAuthenticatedImageBlob(key || src)
      .then((blobUrl) => {
        if (isMounted) {
          if (blobUrl) {
            setImgSrc(blobUrl);
            setHasError(false);
          } else if (fallbackSrc) {
            setImgSrc(fallbackSrc);
          } else {
            setHasError(true);
          }
        }
      })
      .catch(() => {
        if (isMounted) {
          if (fallbackSrc) {
            setImgSrc(fallbackSrc);
          } else {
            setHasError(true);
          }
        }
      });

    return () => {
      isMounted = false;
    };
  }, [src, fallbackSrc]);

  if (!imgSrc || hasError) {
    return (
      <div className={`bg-slate-100 border border-slate-200 text-slate-400 text-xs flex items-center justify-center p-2 rounded ${className}`}>
        {alt || 'Gambar tidak tersedia'}
      </div>
    );
  }

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={className}
      onError={() => {
        if (fallbackSrc && imgSrc !== fallbackSrc) {
          setImgSrc(fallbackSrc);
        } else {
          setHasError(true);
        }
      }}
      {...props}
    />
  );
};
