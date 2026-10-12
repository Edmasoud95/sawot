import ControlIcon from "../ControlIcon";
import { useEffect, useId, useRef, useState } from 'react';
import type { ProductCards as ProductData } from '../../lib/productCards';
import ArticleCard from './ArticleCard';
import MotionButton from '../MotionButton';

export default function ProductCards({ products }: { products: ProductData }) {
  const titleId = useId();
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = () => {
    const node = track.current;
    if (node) setEdges({ start: node.scrollLeft <= 2, end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 2 });
  };
  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track.current!);
    return () => observer.disconnect();
  }, [products]);
  const move = (direction: number) => {
    const node = track.current;
    if (!node) return;
    const distance = (node.firstElementChild?.getBoundingClientRect().width ?? 240) + 12;
    node.scrollBy({ left: distance * direction, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  return <section className="chat-products" aria-labelledby={titleId}>
    <div className="chat-products-header">
      <h3 id={titleId}>{products.title}</h3>
      <div className="chat-products-controls">
        <MotionButton type="button" aria-label="Previous products" disabled={edges.start} onClick={() => move(-1)}>
          <ControlIcon name="previous" size={16} />
        </MotionButton>
        <MotionButton type="button" aria-label="Next products" disabled={edges.end} onClick={() => move(1)}>
          <ControlIcon name="next" size={16} />
        </MotionButton>
      </div>
    </div>
    <ul ref={track} className="chat-products-track" tabIndex={0} aria-label={products.title} onScroll={measure}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
      }}>
      {products.items.map(product => <li key={product.url}>
        <ArticleCard href={product.url} product={product}>{product.title}</ArticleCard>
      </li>)}
    </ul>
  </section>;
}
