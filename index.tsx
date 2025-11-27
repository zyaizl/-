import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { GoogleGenAI } from "@google/genai";

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Declare Chart.js globally since we loaded it via script tag
declare const Chart: any;

type Mode = "calculate" | "plan";

interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

interface ChartDataPoint {
  date: string;
  invested: number;
  value: number;
}

interface AnalysisResult {
  summary: {
    totalInvested: string;
    finalValue: string;
    profit: string;
    profitIsPositive: boolean;
    roi: string;
    cagr: string;
  };
  chartData: ChartDataPoint[];
  analysis: string;
}

const InvestmentChart = ({ data, currencySymbol }: { data: ChartDataPoint[], currencySymbol: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasRef.current || !data.length) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    // Gradient for Value
    const gradientValue = ctx.createLinearGradient(0, 0, 0, 400);
    gradientValue.addColorStop(0, "rgba(16, 185, 129, 0.2)"); // Emerald-500 low opacity
    gradientValue.addColorStop(1, "rgba(16, 185, 129, 0.0)");

    // Gradient for Invested
    const gradientInvested = ctx.createLinearGradient(0, 0, 0, 400);
    gradientInvested.addColorStop(0, "rgba(148, 163, 184, 0.1)");
    gradientInvested.addColorStop(1, "rgba(148, 163, 184, 0.0)");

    chartInstanceRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d => d.date),
        datasets: [
          {
            label: '资产市值 (Market Value)',
            data: data.map(d => d.value),
            borderColor: '#10b981', // Emerald 500
            backgroundColor: gradientValue,
            borderWidth: 3,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 6,
            fill: true,
          },
          {
            label: '投入本金 (Invested Principal)',
            data: data.map(d => d.invested),
            borderColor: '#94a3b8', // Slate 400
            backgroundColor: gradientInvested,
            borderWidth: 2,
            borderDash: [5, 5],
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 6,
            fill: true,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              usePointStyle: true,
              font: { family: "'Noto Sans SC', sans-serif", size: 12 }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            titleFont: { family: "'Noto Sans SC', sans-serif", size: 13 },
            bodyFont: { family: "'Noto Sans SC', sans-serif", size: 13 },
            padding: 12,
            cornerRadius: 8,
            displayColors: true,
            callbacks: {
              label: function(context: any) {
                let label = context.dataset.label || '';
                if (label) {
                    label += ': ';
                }
                if (context.parsed.y !== null) {
                    label += currencySymbol + new Intl.NumberFormat('en-US').format(context.parsed.y);
                }
                return label;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxTicksLimit: 8,
              font: { size: 10 }
            }
          },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: {
              font: { size: 10 },
              callback: function(value: any) {
                return currencySymbol + value;
              }
            }
          }
        }
      }
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
      }
    };
  }, [data, currencySymbol]);

  return <canvas ref={canvasRef} />;
};

const App = () => {
  const [mode, setMode] = useState<Mode>("calculate");
  const [loading, setLoading] = useState(false);
  const [parsedResult, setParsedResult] = useState<AnalysisResult | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [groundingSources, setGroundingSources] = useState<GroundingChunk[]>([]);

  // Form States
  const [asset, setAsset] = useState("纳斯达克100指数 (Nasdaq 100)");
  const [amount, setAmount] = useState(1000);
  const [targetAmount, setTargetAmount] = useState(1000000);
  const [currency, setCurrency] = useState("USD");
  const [frequency, setFrequency] = useState("每月");
  const [startDate, setStartDate] = useState("2018-01-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);

  const currencySymbol = currency === "USD" ? "$" : currency === "CNY" ? "¥" : "HK$";

  const handleCalculate = async () => {
    setLoading(true);
    setParsedResult(null);
    setRawText(null);
    setGroundingSources([]);

    try {
      let prompt = "";
      const freqText = frequency === "每月" ? "Monthly" : frequency === "每周" ? "Weekly" : "Quarterly";

      const jsonStructureExample = `
      {
        "summary": {
          "totalInvested": "12,000",
          "finalValue": "18,500",
          "profit": "6,500",
          "profitIsPositive": true,
          "roi": "54.2%",
          "cagr": "12.5%"
        },
        "chartData": [
           {"date": "2020-01", "invested": 1000, "value": 1000},
           {"date": "2020-02", "invested": 2000, "value": 2150}
        ],
        "analysis": "简短的一段话总结，说明这段时间的市场主要趋势。"
      }
      `;

      const commonInstructions = `
        你是一位高级数据可视化专家和金融分析师。
        任务：基于 Google Search 的真实历史数据进行定投回测，并输出 JSON 数据供前端绘图。

        关键要求：
        1. **必须使用 Google Search** 查找 "${asset}" 在 ${startDate} 到 ${endDate} 的真实历史价格。
        2. 数据点越密集越好（至少包含每个季度的关键数据点，最好是每月）。
        3. 严禁使用 Markdown 代码块（如 \`\`\`json），直接返回纯 JSON 字符串。
        4. 确保 JSON 格式严格有效，可以被 JSON.parse() 解析。
        5. "invested" 和 "value" 字段必须是纯数字（不带逗号或货币符号）。
      `;

      if (mode === "calculate") {
        prompt = `
          ${commonInstructions}
          
          情景：用户从 ${startDate} 开始，${frequency}定投 ${currency} ${amount} 买入 ${asset}，直到 ${endDate}。
          
          请计算：
          1. 累计投入本金 (totalInvested)
          2. 期末资产总值 (finalValue)
          3. 收益率 (ROI) 和 年化收益率 (CAGR)
          4. 生成一条随时间变化的资产曲线数据 (chartData)，包含每个时间点的累计投入和资产市值。
          
          请严格按照以下 JSON 结构返回结果：
          ${jsonStructureExample}
        `;
      } else {
        prompt = `
          ${commonInstructions}
          
          情景：用户希望在 ${endDate} 达成 ${currency} ${targetAmount} 的目标资产。
          标的：${asset}
          开始时间：${startDate}
          频率：${frequency}
          
          请基于真实历史涨幅，倒推计算：用户当时每次需要定投多少金额？
          
          请严格按照以下 JSON 结构返回结果：
          {
            "summary": {
              "totalInvested": "推算出的总本金",
              "finalValue": "${targetAmount}",
              "profit": "推算出的收益",
              "profitIsPositive": true,
              "roi": "推算出的ROI",
              "cagr": "推算出的CAGR"
            },
            "chartData": [
               {"date": "2020-01", "invested": 1000, "value": 1000},
               ... (基于推算出的定投金额模拟的曲线)
            ],
            "analysis": "为了在 ${endDate} 达到目标，你需要${frequency}定投约 [建议金额]。基于历史数据..."
          }
        `;
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      // Extract text
      const text = response.text || "";
      setRawText(text);

      // Extract grounding sources
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      setGroundingSources(chunks);

      // Parse JSON
      try {
        // Clean markdown code blocks if present
        const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const data = JSON.parse(cleanJson);
        setParsedResult(data);
      } catch (e) {
        console.error("JSON Parse Error", e);
        // Fallback or error state could be handled here
      }

    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const PresetButton = ({ label, value, icon }: { label: string; value: string, icon?: string }) => (
    <button
      onClick={() => setAsset(value)}
      className={`group relative flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg border transition-all duration-200 ${
        asset === value
          ? "bg-slate-800 text-white border-slate-800 shadow-md transform scale-[1.02]"
          : "bg-white text-slate-600 border-slate-200 hover:border-blue-400 hover:bg-slate-50 hover:shadow-sm"
      }`}
    >
      {icon && <span className={asset === value ? "text-blue-300" : "text-slate-400 group-hover:text-blue-500"}>{icon}</span>}
      {label}
    </button>
  );

  return (
    <div className="min-h-screen flex flex-col items-center py-8 px-4 sm:px-6 font-sans text-slate-800">
      
      {/* Header Section */}
      <header className="text-center mb-10 mt-4 max-w-3xl">
        <div className="inline-block p-3 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 shadow-xl mb-4">
          <i className="fa-solid fa-chart-line text-3xl text-amber-400"></i>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-800 tracking-tight mb-2">
          真实市场定投回测 <span className="text-blue-600">可视化</span>
        </h1>
        <p className="text-slate-500 text-base sm:text-lg max-w-2xl mx-auto">
          基于 <span className="font-semibold text-slate-700">Gemini</span> 实时搜索历史数据，生成专业投资图表。
        </p>
      </header>

      <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Panel: Configuration */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/20 p-6 sm:p-8 sticky top-6 z-10">
            
            {/* Mode Switcher */}
            <div className="flex bg-slate-100/80 p-1.5 rounded-xl mb-8">
              <button
                onClick={() => setMode("calculate")}
                className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all duration-300 flex items-center justify-center gap-2 ${
                  mode === "calculate"
                    ? "bg-white text-blue-600 shadow-md"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <i className="fa-solid fa-calculator"></i>
                计算收益
              </button>
              <button
                onClick={() => setMode("plan")}
                className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all duration-300 flex items-center justify-center gap-2 ${
                  mode === "plan"
                    ? "bg-white text-emerald-600 shadow-md"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <i className="fa-solid fa-bullseye"></i>
                反推计划
              </button>
            </div>

            {/* Input Form */}
            <div className="space-y-6">
              
              {/* Asset Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">投资标的 (Asset)</label>
                <div className="relative">
                    <input
                    type="text"
                    value={asset}
                    onChange={(e) => setAsset(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all font-medium text-slate-700"
                    placeholder="例如: 纳斯达克100"
                    />
                    <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-3.5 text-slate-400"></i>
                </div>
                
                {/* Popular Presets */}
                <div className="mt-3">
                  <p className="text-[10px] text-slate-400 font-semibold mb-2">热门指数 & 标的</p>
                  <div className="flex flex-wrap gap-2">
                    <PresetButton label="纳斯达克100" value="纳斯达克100指数 (Nasdaq 100)" icon="🇺🇸" />
                    <PresetButton label="标普500" value="标普500指数 (S&P 500)" icon="🇺🇸" />
                    <PresetButton label="恒生科技" value="恒生科技指数 (Hang Seng Tech)" icon="🇭🇰" />
                    <PresetButton label="恒生指数" value="恒生指数 (Hang Seng Index)" icon="🇭🇰" />
                    <PresetButton label="沪深300" value="沪深300指数 (CSI 300)" icon="🇨🇳" />
                    <PresetButton label="茅台" value="贵州茅台 (600519)" icon="🍶" />
                    <PresetButton label="英伟达" value="NVIDIA (NVDA)" icon="🤖" />
                    <PresetButton label="比特币" value="Bitcoin (BTC)" icon="₿" />
                  </div>
                </div>
              </div>

              {/* Currency & Frequency */}
              <div className="grid grid-cols-2 gap-4">
                 <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">币种</label>
                  <div className="relative">
                    <select 
                        value={currency} 
                        onChange={(e) => setCurrency(e.target.value)}
                        className="w-full pl-9 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none appearance-none font-medium text-slate-700"
                    >
                        <option value="USD">美元 (USD)</option>
                        <option value="CNY">人民币 (CNY)</option>
                        <option value="HKD">港币 (HKD)</option>
                    </select>
                    <i className="fa-solid fa-coins absolute left-3.5 top-3.5 text-slate-400"></i>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">定投频率</label>
                  <div className="relative">
                    <select 
                        value={frequency} 
                        onChange={(e) => setFrequency(e.target.value)}
                        className="w-full pl-9 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none appearance-none font-medium text-slate-700"
                    >
                        <option value="每月">每月 (Monthly)</option>
                        <option value="每周">每周 (Weekly)</option>
                        <option value="每季">每季 (Quarterly)</option>
                    </select>
                    <i className="fa-regular fa-calendar absolute left-3.5 top-3.5 text-slate-400"></i>
                  </div>
                </div>
              </div>

              {/* Amount Input */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    {mode === "calculate" ? "每期定投金额" : "目标资产金额"}
                </label>
                <div className="relative">
                    <span className="absolute left-4 top-3 font-bold text-slate-400">
                        {currencySymbol}
                    </span>
                    <input
                        type="number"
                        value={mode === "calculate" ? amount : targetAmount}
                        onChange={(e) => mode === "calculate" ? setAmount(Number(e.target.value)) : setTargetAmount(Number(e.target.value))}
                        className={`w-full pl-9 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:border-transparent outline-none font-bold text-lg text-slate-800 ${
                            mode === "calculate" ? "focus:ring-blue-500" : "focus:ring-emerald-500"
                        }`}
                    />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">开始日期</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-medium text-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">结束日期</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-medium text-slate-700"
                  />
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={handleCalculate}
                disabled={loading}
                className={`w-full mt-6 py-4 rounded-xl text-white font-bold text-lg shadow-[0_10px_20px_-10px_rgba(0,0,0,0.2)] transform transition-all active:scale-[0.98] relative overflow-hidden group ${
                  loading 
                    ? "bg-slate-400 cursor-not-allowed" 
                    : mode === "calculate" 
                      ? "bg-slate-900 hover:bg-slate-800"
                      : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {/* Shine Effect */}
                <div className="absolute inset-0 h-full w-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
                
                {loading ? (
                  <span className="flex items-center justify-center gap-3">
                    <i className="fa-solid fa-circle-notch fa-spin text-xl"></i> 数据计算中...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    {mode === "calculate" ? <i className="fa-solid fa-chart-area"></i> : <i className="fa-solid fa-wand-magic-sparkles"></i>}
                    {mode === "calculate" ? "生成收益图表" : "生成定投计划"}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel: Results */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {parsedResult ? (
            <>
              {/* 1. Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white/90 backdrop-blur-sm p-5 rounded-2xl shadow-sm border border-slate-100">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">总投入本金</p>
                  <p className="text-xl sm:text-2xl font-bold text-slate-700">{currencySymbol}{parsedResult.summary.totalInvested}</p>
                </div>
                <div className="bg-white/90 backdrop-blur-sm p-5 rounded-2xl shadow-sm border border-slate-100">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">期末资产总值</p>
                  <p className={`text-xl sm:text-2xl font-bold ${parsedResult.summary.profitIsPositive ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {currencySymbol}{parsedResult.summary.finalValue}
                  </p>
                </div>
                 <div className="bg-white/90 backdrop-blur-sm p-5 rounded-2xl shadow-sm border border-slate-100">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">总收益率 (ROI)</p>
                  <p className={`text-xl sm:text-2xl font-bold ${parsedResult.summary.profitIsPositive ? 'text-emerald-600' : 'text-rose-500'}`}>
                     {parsedResult.summary.roi}
                  </p>
                </div>
                 <div className="bg-white/90 backdrop-blur-sm p-5 rounded-2xl shadow-sm border border-slate-100">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">年化收益 (CAGR)</p>
                  <p className={`text-xl sm:text-2xl font-bold ${parsedResult.summary.profitIsPositive ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {parsedResult.summary.cagr}
                  </p>
                </div>
              </div>

              {/* 2. Main Chart */}
              <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/20 p-2 sm:p-6 h-[400px] flex flex-col relative z-0">
                  <div className="flex justify-between items-center mb-4 px-2">
                     <h3 className="font-bold text-slate-700 flex items-center gap-2">
                       <i className="fa-solid fa-arrow-trend-up text-blue-500"></i>
                       资产增长曲线
                     </h3>
                     <div className="flex gap-4 text-xs font-medium">
                        <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                            <span className="text-slate-500">资产市值</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-slate-400/50"></span>
                            <span className="text-slate-500">投入本金</span>
                        </div>
                     </div>
                  </div>
                  <div className="flex-1 w-full h-full relative">
                     <InvestmentChart data={parsedResult.chartData} currencySymbol={currencySymbol} />
                  </div>
              </div>

              {/* 3. Analysis Text */}
              <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-[0_4px_20px_rgb(0,0,0,0.02)] border border-white/20 p-6 sm:p-8">
                 <h3 className="text-sm font-extrabold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <i className="fa-solid fa-lightbulb text-amber-400"></i>
                    市场分析
                 </h3>
                 <div className="markdown-content text-slate-600">
                    {parsedResult.analysis}
                 </div>
              </div>

              {/* 4. Sources */}
              {groundingSources.length > 0 && (
                  <div className="bg-slate-50/50 rounded-2xl border border-slate-200/60 p-4">
                    <h3 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <i className="fa-solid fa-database text-slate-400"></i>
                      真实数据来源
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {groundingSources.map((source, idx) => (
                        source.web?.uri && (
                          <a 
                            key={idx}
                            href={source.web.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center px-2 py-1 bg-white border border-slate-200 rounded-md text-[10px] text-slate-500 hover:text-blue-600 hover:border-blue-200 transition-colors"
                          >
                            <span className="truncate max-w-[150px]">{source.web.title}</span>
                            <i className="fa-solid fa-external-link-alt ml-1.5 opacity-50"></i>
                          </a>
                        )
                      ))}
                    </div>
                  </div>
                )}
            </>
          ) : (
            <div className="h-full min-h-[500px] bg-white/60 backdrop-blur-md rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
               {!rawText ? (
                 <>
                    <div className="w-20 h-20 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] flex items-center justify-center mb-6 transform rotate-3 transition-transform hover:rotate-6">
                        <i className="fa-solid fa-chart-pie text-4xl text-slate-300"></i>
                    </div>
                    <h3 className="text-xl font-bold text-slate-700 mb-2">数据可视化大屏</h3>
                    <p className="max-w-md text-slate-500 mb-8">
                        请在左侧选择参数，AI 将生成：<br/>
                        1. 资金积累曲线图<br/>
                        2. 详细的收益率分析<br/>
                        3. 基于真实历史数据的复盘
                    </p>
                    <div className="flex gap-3 opacity-40">
                         <div className="h-32 w-4 bg-slate-300 rounded-t-lg"></div>
                         <div className="h-20 w-4 bg-slate-300 rounded-t-lg"></div>
                         <div className="h-40 w-4 bg-slate-300 rounded-t-lg"></div>
                         <div className="h-24 w-4 bg-slate-300 rounded-t-lg"></div>
                    </div>
                 </>
               ) : (
                 <div className="text-rose-500 bg-rose-50 p-6 rounded-xl border border-rose-100 max-w-lg">
                    <i className="fa-solid fa-triangle-exclamation text-2xl mb-2"></i>
                    <p className="font-bold">数据解析失败</p>
                    <p className="text-xs mt-2 opacity-80">AI 返回的数据格式不正确，请尝试缩短时间范围或更换标的重试。</p>
                 </div>
               )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(<App />);