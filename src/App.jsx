import React, { useState, useEffect, useMemo, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import './App.css'; 

const CONSTANT_SPEED = 0.25;
const EDGE_PERSISTENCE = 8000; 
const TX_INTERVAL = 600; // Constant milliseconds between each transaction firing

export default function App() {
  const graphRef = useRef();
  
  const [dataset, setDataset] = useState([]);
  const [nodesArray, setNodesArray] = useState([]);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 600 });
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const pointerRef = useRef(0);
  const activeTxRef = useRef([]);
  const balancesRef = useRef(new Map());
  const lastTouchedRef = useRef(new Map());
  const currentVolRef = useRef(0);
  const currentBlockRef = useRef('-');
  const currentBlockDiffRef = useRef(0);
  const currentTsRef = useRef('-');

  const padding = 0.8;

  useEffect(() => {
    fetch('/transfers.json')
      .then(res => res.json())
      .then(data => {
        const columns = data.columns;
        if (!columns || columns.length === 0) return;

        const rowCount = columns[0].values.length;
        const rowData = [];

        for (let i = 0; i < rowCount; i++) {
          const row = {};
          columns.forEach(col => {
            row[col.name.toLowerCase()] = col.values[i];
          });
          rowData.push(row);
        }

        rowData.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

        const nodesMap = new Map();
        rowData.forEach(tx => {
          if (tx.from && !nodesMap.has(tx.from)) {
            nodesMap.set(tx.from, { 
              id: tx.from, 
              x: (Math.random() - 0.5) * 100, 
              y: (Math.random() - 0.5) * 100 
            });
          }
          if (tx.to && !nodesMap.has(tx.to)) {
            nodesMap.set(tx.to, { 
              id: tx.to, 
              x: (Math.random() - 0.5) * 100, 
              y: (Math.random() - 0.5) * 100 
            });
          }
        });

        const processedData = [];
        
        // Use a counter instead of the raw timestamp to force constant spacing
        let sequenceIndex = 0;

        rowData.forEach(tx => {
          const sourceObj = nodesMap.get(tx.from);
          const targetObj = nodesMap.get(tx.to);
          if (!sourceObj || !targetObj || sourceObj === targetObj) return;

          // Artificial timeline: strictly sequential spacing
          const normalizedTime = sequenceIndex * TX_INTERVAL;
          
          // Calculate block difference from the last valid transaction processed
          const prevTx = processedData.length > 0 ? processedData[processedData.length - 1] : tx;
          const blockDiff = Math.max(0, Number(tx.blocknumber) - Number(prevTx.blocknumber));

          const dist = Math.hypot(targetObj.x - sourceObj.x, targetObj.y - sourceObj.y);
          const duration = dist / CONSTANT_SPEED;
          const value = Number(tx.value) || 0;

          processedData.push({
            ...tx,
            source: sourceObj.id,
            target: targetObj.id,
            sourceObj,
            targetObj,
            value,
            normalizedTime,
            blockDiff,
            duration,
            endTime: normalizedTime + duration + EDGE_PERSISTENCE 
          });

          sequenceIndex++;
        });

        setNodesArray(Array.from(nodesMap.values()));
        setDataset(processedData);
      })
      .catch(err => console.error("Error loading dataset:", err));
  }, [dimensions.width, dimensions.height]); 

  useEffect(() => {
    let requestRef;
    let lastTime = performance.now();
    const animate = (time) => {
      if (isPlaying && dataset.length > 0) {
        const delta = time - lastTime;
        setElapsed(prev => prev + delta);
      }
      lastTime = time;
      requestRef = requestAnimationFrame(animate);
    };
    requestRef = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef);
  }, [isPlaying, dataset.length]);

  const handleRestart = () => {
    pointerRef.current = 0;
    activeTxRef.current = [];
    balancesRef.current.clear();
    lastTouchedRef.current.clear();
    currentVolRef.current = 0;
    currentBlockRef.current = '-';
    currentBlockDiffRef.current = 0;
    currentTsRef.current = '-';
    setElapsed(0);
    setIsPlaying(true);
  };

  const { graphData, totalVolume, activeCount, currentBlock, currentBlockDiff, currentTimestamp } = useMemo(() => {
    if (dataset.length === 0) return { graphData: { nodes: [], links: [] }, totalVolume: 0, activeCount: 0, currentBlock: '-', currentBlockDiff: 0, currentTimestamp: '-' };

    const balances = balancesRef.current;
    const lastTouched = lastTouchedRef.current;
    let activeLinks = activeTxRef.current;

    while (pointerRef.current < dataset.length && dataset[pointerRef.current].normalizedTime <= elapsed) {
      const tx = dataset[pointerRef.current];
      activeLinks.push(tx); 

      balances.set(tx.from, (balances.get(tx.from) || 0) - tx.value);
      balances.set(tx.to, (balances.get(tx.to) || 0) + tx.value);
      
      currentVolRef.current += tx.value;
      currentBlockRef.current = tx.blocknumber;
      currentBlockDiffRef.current = tx.blockDiff;
      currentTsRef.current = tx.timestamp;

      pointerRef.current++;
    }

    const currentlyActiveNodes = new Set();
    
    activeLinks.forEach(tx => {
      if (elapsed <= tx.endTime) {
        currentlyActiveNodes.add(tx.from);
        currentlyActiveNodes.add(tx.to);
        lastTouched.set(tx.from, elapsed);
        lastTouched.set(tx.to, elapsed);
      }
    });
    
    activeTxRef.current = activeLinks;

    const activeNodes = [];

    nodesArray.forEach(node => {
      const bal = balances.get(node.id) || 0;
      const isPulse = currentlyActiveNodes.has(node.id);
      const lastActive = lastTouched.get(node.id) || 0;

      node.balance = bal;
      node.isPulse = isPulse;
      node.lastActive = lastActive;

      if (lastActive > 0) {
        activeNodes.push(node);
      }
    });

    return {
      graphData: { nodes: activeNodes, links: activeLinks },
      totalVolume: currentVolRef.current,
      activeCount: currentlyActiveNodes.size, 
      currentBlock: currentBlockRef.current,
      currentBlockDiff: currentBlockDiffRef.current,
      currentTimestamp: currentTsRef.current
    };
  }, [elapsed, dataset, nodesArray]);

  return (
    <div className="app">
      <div className="two-column-layout">
        <div className="cards-column">
          <h1 className="title">Nochill Transfer Timelapse</h1>
          <div style={{ display: 'flex', gap: '10px', margin: '1rem 0' }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={dataset.length === 0}
              style={{ background: isPlaying ? '#ff7777' : '#3eb75a', color: '#000', border: 'none', padding: '1rem', borderRadius: '8px', fontWeight: 'bold', cursor: dataset.length === 0 ? 'not-allowed' : 'pointer', flexGrow: 1, opacity: dataset.length === 0 ? 0.5 : 1 }}
            >
              {isPlaying ? 'STOP' : 'RUN'}
            </button>
            <button
              onClick={handleRestart}
              disabled={dataset.length === 0}
              style={{ background: '#333', color: '#fff', border: '1px solid #555', padding: '1rem', borderRadius: '8px', fontWeight: 'bold', cursor: dataset.length === 0 ? 'not-allowed' : 'pointer', opacity: dataset.length === 0 ? 0.5 : 1 }}
            >
              RESTART
            </button>
          </div>

          <div className="card frosted">
            <div className="stat-label">Current Block</div>
            <div className="stat-value" style={{ color: '#fff', display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              {currentBlock}
              {currentBlock !== '-' && (
                <span style={{ color: '#3eb75a', fontSize: '1.2rem', fontWeight: 'normal' }}>
                  (+{currentBlockDiff})
                </span>
              )}
            </div>
            <div style={{ color: '#555', fontSize: '0.85rem', marginTop: '0.25rem', fontFamily: 'monospace' }}>
              TS: {currentTimestamp}
            </div>
          </div>

          <div className="card frosted">
            <div className="stat-label">Active Nodes</div>
            <div className="stat-value" style={{ color: '#ff7777' }}>{activeCount}</div>
          </div>
          <div className="card frosted">
            <div className="stat-label">Total Volume</div>
            <div className="stat-value">{totalVolume.toLocaleString()}</div>
          </div>
          <p className="subtitle">made by t</p>
        </div>

        <div className="chart-column">
          <div className="chart-wrapper frosted" style={{ width: '90%', height: '90%', position: 'relative', overflow: 'hidden' }}>
            <ForceGraph2D
              ref={(graph) => {
                graphRef.current = graph;
                if (graph) {
                  graph.d3Force('charge').strength(-100); 
                  graph.d3Force('link').distance(250);    
                }
              }}
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              backgroundColor="rgba(0,0,0,0)"

              nodeCanvasObject={(node, ctx, globalScale) => {
                const isStale = node.balance <= 0 && !node.isPulse;
                const size = 50; 

                ctx.beginPath();
                ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
                ctx.fillStyle = isStale ? '#444' : '#f88';
                ctx.fill();

                if (!isStale) {
                  ctx.shadowBlur = 15 / globalScale;
                  ctx.shadowColor = '#f88';
                }

                ctx.shadowBlur = 0;
              }}

              linkCanvasObject={(link, ctx, globalScale) => {
                const start = link.source;
                const end = link.target;
                
                if (start.x === undefined || end.x === undefined) return;

                const cpX = (start.x + end.x) / 2 + (end.y - start.y) * 0.25;
                const cpY = (start.y + end.y) / 2 - (end.x - start.x) * 0.25;

                ctx.beginPath();
                ctx.moveTo(start.x, start.y);
                ctx.quadraticCurveTo(cpX, cpY, end.x, end.y);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; 
                ctx.lineWidth = 1.5 / globalScale;
                ctx.stroke();

                const progress = (elapsed - link.normalizedTime) / link.duration;
                if (progress < 0 || progress > 1.2) return; 

                const currentT = Math.min(progress, 1);
                const invT = 1 - currentT;

                const currentPos = {
                  x: invT * invT * start.x + 2 * invT * currentT * cpX + currentT * currentT * end.x,
                  y: invT * invT * start.y + 2 * invT * currentT * cpY + currentT * currentT * end.y
                };

                const subCpX = invT * start.x + currentT * cpX;
                const subCpY = invT * start.y + currentT * cpY;

                ctx.beginPath();
                ctx.moveTo(start.x, start.y);
                ctx.quadraticCurveTo(subCpX, subCpY, currentPos.x, currentPos.y);

                const trailOpacity = Math.max(0, (1.2 - progress) * 0.4);
                ctx.strokeStyle = `rgba(248, 136, 136, ${trailOpacity})`;
                ctx.lineWidth = 3 / globalScale;
                ctx.stroke();

                if (progress <= 1) {
                  ctx.beginPath();
                  ctx.arc(currentPos.x + (Math.random() - 0.5) * 2, currentPos.y + (Math.random() - 0.5) * 2, 5 / globalScale, 0, 2 * Math.PI);
                  ctx.fillStyle = '#fff';
                  ctx.shadowBlur = 25 / globalScale;
                  ctx.shadowColor = '#f88';
                  ctx.fill();
                  ctx.shadowBlur = 0;
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}