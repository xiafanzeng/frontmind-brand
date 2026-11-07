import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import IntentQuestionCatalog from './IntentQuestionCatalog';

afterEach(cleanup);
const q = {id:'q-stable',question:'如何管理企业知识？',category:'industry',subdivision:'',tableId:'t',rowIndex:7,sourceRevision:2};
function setup() {
  const onViewPlan=vi.fn(), onGeneratePlan=vi.fn(), onOpenAnswer=vi.fn();
  const props={questions:[q],visible:[q],evaluations:[{questionId:q.id,value:80,support:50,points:[{title:'核验功能',status:'missing'},{title:'部署条件',status:'partial'},{title:'费用依据',status:'missing'}]}] as any,
    received:[],integration:{onOpenAnswer},search:'',selected:[],pending:false,page:0,pageCount:1,total:1,savedPlanIds:[q.id],
    onSearch:vi.fn(),onToggle:vi.fn(),onSelectPage:vi.fn(),onClear:vi.fn(),onEvaluate:vi.fn(),onViewPlan,onGeneratePlan,onPage:vi.fn(),onHistory:vi.fn(),historyCount:9};
  render(<IntentQuestionCatalog {...props}/>);
  return {onViewPlan,onGeneratePlan,onOpenAnswer};
}
describe('approved catalog presentation with real question identities',()=>{
  it('removes secondary labels and folds all actual gaps into one panel',()=>{
    setup();
    expect(screen.queryByText(/查看已保存评估/)).toBeNull();
    expect(screen.queryByRole('button',{name:/历史记录/})).toBeNull();
    expect(screen.queryByRole('columnheader',{name:'优化状态'})).toBeNull();
    expect(screen.queryByRole('combobox',{name:'问题状态'})).toBeNull();
    expect(screen.queryByRole('combobox',{name:'问题分类'})).toBeNull();
    expect(screen.queryByText('全部类别')).toBeNull();
    expect(screen.queryByText('全部状态')).toBeNull();
    expect(screen.queryByText('部分支撑')).toBeNull();
    expect(screen.queryByText('较充分')).toBeNull();
    expect(screen.queryByText('支撑不足')).toBeNull();
    expect(screen.getByRole('button', {name:`查看知识支撑：${q.question}`}).textContent).toBe('50 / 100');
    const summary=document.querySelector('.iw-catalog-gaps summary')!;
    expect(summary.textContent).toBe('核验功能等');
    const disclosure=summary.closest('details')!;
    expect(disclosure.open).toBe(false);
    expect(disclosure.querySelectorAll('li')).toHaveLength(3);
    fireEvent.click(summary);
    expect(disclosure.open).toBe(true);
    expect(disclosure.querySelector('li')?.textContent).toBe('01核验功能');
    expect(screen.getByText('部署条件')).toBeTruthy();
    expect(screen.getByText('费用依据')).toBeTruthy();
    expect(document.querySelector('.iw-catalog-category')).toBeNull();
  });
  it('keeps the saved-plan callback and question ID, and changes only its visual priority',()=>{
    const {onViewPlan,onGeneratePlan,onOpenAnswer}=setup();
    const plan=screen.getByRole('button',{name:'查看优化方案'});
    expect(plan.classList.contains('iw-primary')).toBe(false);
    fireEvent.click(plan);
    expect(onViewPlan).toHaveBeenCalledWith(q.id);
    expect(onGeneratePlan).not.toHaveBeenCalled();
    const answer=screen.getByRole('button',{name:'进入应答逻辑'});
    expect(answer.classList.contains('iw-primary')).toBe(true);
    fireEvent.click(answer);
    expect(onOpenAnswer).toHaveBeenCalledWith(q);
  });
});
