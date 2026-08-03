// Galeria de receitas: escolher uma automação pronta (ou começar em branco).
// Abre do estado vazio e do botão "Nova automação". Grid de cards + filtro por
// categoria (pills) + busca — lista linear não escalava bem com ~20 receitas.
import { useMemo, useState } from 'react';
import { X, FilePlus, Search } from 'lucide-react';
import { RECIPES, RECIPE_CATEGORIES, type Recipe, type RecipeCategory } from './recipes';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type CategoryFilter = 'all' | RecipeCategory;

export function RecipesGallery({
  onPick,
  onBlank,
  onClose,
  busy,
}: {
  onPick: (recipe: Recipe) => void;
  onBlank: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const q = norm(search.trim());
  const bySearch = q
    ? RECIPES.filter((r) => norm(r.name).includes(q) || norm(r.description).includes(q))
    : RECIPES;

  // Contagens por categoria calculadas sobre o resultado da busca, não do total —
  // assim os pills refletem o que a busca atual realmente tem disponível.
  const counts = useMemo(() => {
    const c = new Map<RecipeCategory, number>();
    for (const r of bySearch) c.set(r.category, (c.get(r.category) ?? 0) + 1);
    return c;
  }, [bySearch]);

  const filtered = category === 'all' ? bySearch : bySearch.filter((r) => r.category === category);

  const categoryList = Object.keys(RECIPE_CATEGORIES) as RecipeCategory[];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              Nova automação
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Comece de uma receita pronta ({RECIPES.length} disponíveis) ou monte do zero.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={17} />
          </button>
        </div>

        <div className="px-5 pt-3 pb-3 border-b border-slate-100 dark:border-slate-800 flex-shrink-0 space-y-2.5">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou o que faz…"
              className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCategory('all')}
              className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                category === 'all'
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              Todas ({bySearch.length})
            </button>
            {categoryList.map((cat) => {
              const n = counts.get(cat) ?? 0;
              if (n === 0) return null;
              const active = category === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setCategory(active ? 'all' : cat)}
                  className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                    active
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  {RECIPE_CATEGORIES[cat]} ({n})
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-y-auto scrollbar-thin p-5 flex-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">
              Nenhuma receita bate com esse filtro.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((r) => (
                <button
                  key={r.id}
                  disabled={busy}
                  onClick={() => onPick(r)}
                  className="flex flex-col items-start gap-2 text-left rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all disabled:opacity-50 group h-full"
                >
                  <div className="flex items-center gap-2.5 w-full">
                    <span className="flex-shrink-0 rounded-lg p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:bg-blue-500/15 transition-colors">
                      <r.icon size={17} />
                    </span>
                    <div className="font-medium text-sm text-slate-800 dark:text-slate-100 leading-snug">
                      {r.name}
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug line-clamp-3">
                    {r.description}
                  </p>
                  {r.todo && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 line-clamp-2 mt-auto pt-1">
                      Para completar: {r.todo}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex-shrink-0">
          <button
            disabled={busy}
            onClick={onBlank}
            className="w-full flex items-center gap-3 text-left rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-3 hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors disabled:opacity-50"
          >
            <span className="flex-shrink-0 rounded-lg p-2 bg-slate-500/10 text-slate-500">
              <FilePlus size={18} />
            </span>
            <div>
              <div className="font-medium text-sm text-slate-800 dark:text-slate-100">
                Em branco
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Canvas vazio — você escolhe o gatilho.
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
